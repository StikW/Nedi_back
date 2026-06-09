import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users.service';
import { User } from '../../models/user.entity';

export interface ConnectResult {
  instance: string;
  /** QR en base64 (data URL) para vincular el numero */
  qrBase64?: string;
  /** Pairing code alternativo */
  pairingCode?: string;
  status: 'connecting' | 'connected';
}

export interface ConnectionStatus {
  instance: string;
  state: string; // open | connecting | close
  status: 'connected' | 'connecting' | 'disconnected';
  number?: string;
}

/**
 * Gestiona el ciclo de vida de la instancia de Evolution de cada instructor
 * (crear, vincular via QR, consultar estado, desconectar). Unifica el proceso
 * de "conectar numero de capacitacion" desde la plataforma.
 */
@Injectable()
export class EvolutionAdminService {
  private readonly logger = new Logger(EvolutionAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  private serverUrl(): string {
    const url = this.configService.get<string>('EVOLUTION_SERVER_URL');
    if (!url) {
      throw new HttpException('EVOLUTION_SERVER_URL no configurado', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return url.replace(/\/+$/, '');
  }

  private adminKey(): string {
    const key = this.configService.get<string>('EVOLUTION_ADMIN_API_KEY');
    if (!key) {
      throw new HttpException('EVOLUTION_ADMIN_API_KEY no configurado', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return key;
  }

  private instanceNameFor(instructor: User): string {
    return instructor.evolutionInstance || `nedi_${instructor.id}`;
  }

  private webhookUrl(): string | undefined {
    return this.configService.get<string>('AGENT_WEBHOOK_PUBLIC_URL') || undefined;
  }

  /**
   * Crea (si no existe) la instancia del instructor, configura su webhook hacia
   * el agente y devuelve el QR para vincular el numero.
   */
  async connect(instructor: User): Promise<ConnectResult> {
    const instance = this.instanceNameFor(instructor);
    const webhook = this.webhookUrl();

    // 1. Crear instancia (idempotente: si ya existe, Evolution responde 403/409 y seguimos a connect)
    const createBody: any = {
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    };
    if (webhook) {
      createBody.webhook = {
        url: webhook,
        byEvents: false,
        base64: true,
        events: ['MESSAGES_UPSERT'],
      };
    }

    let createdApiKey: string | undefined;
    let qrFromCreate: string | undefined;
    try {
      const created = await this.request('POST', `/instance/create`, this.adminKey(), createBody);
      createdApiKey = created?.hash?.apikey || created?.hash || created?.instance?.apikey;
      qrFromCreate = created?.qrcode?.base64;
    } catch (err: any) {
      // Si ya existe, continuamos para obtener el QR via connect
      this.logger.warn(`create instance "${instance}" (puede ya existir): ${err?.message || err}`);
    }

    // Persistir instancia + apikey (si Evolution la devolvio) y estado connecting
    await this.usersService.updateEvolutionConfig(instructor.id, {
      evolutionInstance: instance,
      evolutionApiKey: createdApiKey || instructor.evolutionApiKey,
      evolutionStatus: 'connecting',
    });

    // 2. Asegurar webhook (por si la instancia ya existia)
    if (webhook) {
      await this.safeSetWebhook(instance, createdApiKey || instructor.evolutionApiKey || this.adminKey(), webhook);
    }

    // 3. Obtener QR
    let qrBase64 = qrFromCreate;
    let pairingCode: string | undefined;
    if (!qrBase64) {
      try {
        const conn = await this.request(
          'GET',
          `/instance/connect/${instance}`,
          createdApiKey || instructor.evolutionApiKey || this.adminKey(),
        );
        qrBase64 = conn?.base64 || conn?.qrcode?.base64;
        pairingCode = conn?.pairingCode || conn?.code;
      } catch (err: any) {
        this.logger.warn(`connect/${instance}: ${err?.message || err}`);
      }
    }

    return { instance, qrBase64, pairingCode, status: 'connecting' };
  }

  /** Consulta el estado de conexion y lo persiste en el instructor. */
  async status(instructor: User): Promise<ConnectionStatus> {
    const fresh = await this.usersService.findById(instructor.id);
    const instance = this.instanceNameFor(fresh);
    const apiKey = fresh.evolutionApiKey || this.adminKey();

    if (!fresh.evolutionInstance && !fresh.evolutionApiKey) {
      return { instance, state: 'close', status: 'disconnected' };
    }

    let state = 'close';
    try {
      const res = await this.request('GET', `/instance/connectionState/${instance}`, apiKey);
      state = res?.instance?.state || res?.state || 'close';
    } catch (err: any) {
      this.logger.warn(`connectionState/${instance}: ${err?.message || err}`);
      const fallback = fresh.evolutionStatus === 'connecting' ? 'connecting' : 'disconnected';
      return { instance, state: 'close', status: fallback };
    }

    const status = this.resolveConnectionStatus(state, fresh);

    let number = fresh.evolutionNumber;
    if (status === 'connected') {
      const fetched = await this.fetchInstanceNumber(instance, apiKey);
      if (fetched) number = fetched;
    }

    await this.usersService.updateEvolutionConfig(fresh.id, {
      evolutionStatus: status,
      ...(number ? { evolutionNumber: number } : {}),
    });

    return { instance, state, status, number };
  }

  /**
   * Evolution devuelve `close` mientras espera el escaneo del QR (aun no vinculado).
   * Solo tratamos `close` como desconectado si el instructor no esta en flujo connecting.
   */
  private resolveConnectionStatus(state: string, instructor: User): ConnectionStatus['status'] {
    if (state === 'open') return 'connected';
    if (state === 'connecting') return 'connecting';
    if (instructor.evolutionStatus === 'connecting') return 'connecting';
    return 'disconnected';
  }

  /** Obtiene el numero de WhatsApp vinculado a la instancia desde Evolution. */
  private async fetchInstanceNumber(instance: string, apiKey: string): Promise<string | undefined> {
    try {
      const res = await this.request(
        'GET',
        `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
        apiKey,
      );
      const list: any[] = Array.isArray(res) ? res : res?.instances ? res.instances : res ? [res] : [];
      const match =
        list.find((item) => (item?.instance?.instanceName || item?.instanceName) === instance) ||
        list[0];
      const owner: string | undefined =
        match?.owner || match?.instance?.owner || match?.instance?.wuid;
      if (!owner || typeof owner !== 'string') return undefined;
      return owner.split('@')[0] || undefined;
    } catch (err: any) {
      this.logger.warn(`fetchInstances/${instance}: ${err?.message || err}`);
      return undefined;
    }
  }

  /** Desvincula el numero (logout de la instancia). */
  async logout(instructor: User): Promise<{ instance: string; success: boolean }> {
    const instance = this.instanceNameFor(instructor);
    const apiKey = instructor.evolutionApiKey || this.adminKey();
    try {
      await this.request('DELETE', `/instance/logout/${instance}`, apiKey);
    } catch (err: any) {
      this.logger.warn(`logout/${instance}: ${err?.message || err}`);
    }
    await this.usersService.updateEvolutionConfig(instructor.id, { evolutionStatus: 'disconnected' });
    return { instance, success: true };
  }

  private async safeSetWebhook(instance: string, apiKey: string, url: string): Promise<void> {
    try {
      await this.request('POST', `/webhook/set/${instance}`, apiKey, {
        webhook: {
          enabled: true,
          url,
          base64: true,
          byEvents: false,
          events: ['MESSAGES_UPSERT'],
        },
      });
    } catch (err: any) {
      this.logger.warn(`set webhook ${instance}: ${err?.message || err}`);
    }
  }

  private async request(method: string, path: string, apiKey: string, body?: any): Promise<any> {
    const url = `${this.serverUrl()}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Evolution ${method} ${path} -> ${res.status} ${json?.message || ''}`);
    }
    return json;
  }
}
