import { Injectable, Logger, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
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
  private readonly requestTimeoutMs = 15_000;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
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

  /** Comprueba si el backend puede contactar Evolution (diagnóstico). */
  async checkHealth(): Promise<{ reachable: boolean; serverUrl: string; message?: string }> {
    const serverUrl = this.serverUrl();
    try {
      await this.request('GET', '/instance/fetchInstances', this.adminKey());
      return { reachable: true, serverUrl };
    } catch (err: any) {
      return { reachable: false, serverUrl, message: err?.message || String(err) };
    }
  }

  private instancePath(instance: string): string {
    return encodeURIComponent(instance);
  }

  private isNetworkError(err: unknown): boolean {
    const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
    return msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout');
  }

  private evolutionUnavailableException(cause?: unknown): HttpException {
    const detail = cause ? `: ${(cause as Error)?.message || cause}` : '';
    return new HttpException(
      `No hay conexión con el servidor Evolution${detail}. Verifica que EVOLUTION_SERVER_URL sea accesible desde este entorno (firewall, VPN o túnel SSH).`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * Crea (si no existe) la instancia del instructor, configura su webhook hacia
   * el agente y devuelve el QR para vincular el numero.
   */
  async connect(instructor: User): Promise<ConnectResult> {
    const instance = this.instanceNameFor(instructor);
    const webhook = this.webhookUrl();
    const adminKey = this.adminKey();

    const existingState = await this.readConnectionState(instance, adminKey);
    if (existingState === 'open') {
      return this.finalizeConnected(instructor, instance, adminKey);
    }

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
      const created = await this.request('POST', '/instance/create', adminKey, createBody);
      createdApiKey = created?.hash?.apikey || created?.hash || created?.instance?.apikey;
      qrFromCreate = created?.qrcode?.base64;
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        throw this.evolutionUnavailableException(err);
      }
      this.logger.warn(`create instance "${instance}" (puede ya existir): ${err?.message || err}`);
      const meta = await this.fetchInstanceMeta(instance, adminKey);
      if (meta.apiKey) createdApiKey = meta.apiKey;
    }

    const resolvedApiKey = createdApiKey || instructor.evolutionApiKey || adminKey;

    if (!webhook) {
      this.logger.error(
        `AGENT_WEBHOOK_PUBLIC_URL no configurado: la instancia "${instance}" no recibira mensajes del agente`,
      );
    }

    // 2. Asegurar webhook (por si la instancia ya existia)
    if (webhook) {
      await this.safeSetWebhook(instance, resolvedApiKey, webhook);
    }

    // 3. Obtener QR
    let qrBase64 = qrFromCreate;
    let pairingCode: string | undefined;
    if (!qrBase64) {
      try {
        const conn = await this.request(
          'GET',
          `/instance/connect/${this.instancePath(instance)}`,
          resolvedApiKey,
        );
        qrBase64 = conn?.base64 || conn?.qrcode?.base64;
        pairingCode = conn?.pairingCode || conn?.code;
      } catch (err: any) {
        if (this.isNetworkError(err)) {
          throw this.evolutionUnavailableException(err);
        }
        this.logger.warn(`connect/${instance}: ${err?.message || err}`);
      }
    }

    const stateAfterConnect = await this.readConnectionState(instance, resolvedApiKey);
    if (stateAfterConnect === 'open') {
      return this.finalizeConnected(instructor, instance, resolvedApiKey);
    }

    if (!qrBase64 && !pairingCode) {
      throw new HttpException(
        'Evolution no devolvió código QR. Revisa que la instancia exista y que el servicio esté operativo.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.usersService.updateEvolutionConfig(instructor.id, {
      evolutionInstance: instance,
      ...(resolvedApiKey && resolvedApiKey !== adminKey
        ? { evolutionApiKey: resolvedApiKey }
        : createdApiKey
          ? { evolutionApiKey: createdApiKey }
          : {}),
      evolutionStatus: 'connecting',
    });

    return { instance, qrBase64, pairingCode, status: 'connecting' };
  }

  private async finalizeConnected(
    instructor: User,
    instance: string,
    apiKey: string,
  ): Promise<ConnectResult> {
    const meta = await this.fetchInstanceMeta(instance, apiKey);
    await this.usersService.updateEvolutionConfig(instructor.id, {
      evolutionInstance: instance,
      evolutionStatus: 'connected',
      ...(meta.apiKey ? { evolutionApiKey: meta.apiKey } : {}),
      ...(meta.number ? { evolutionNumber: meta.number } : {}),
    });
    if (meta.number) {
      await this.usersService.syncInstructorPhoneFromEvolution(instructor.id, meta.number);
    }
    const webhook = this.webhookUrl();
    if (webhook) {
      await this.safeSetWebhook(instance, meta.apiKey || apiKey, webhook);
    }
    return { instance, status: 'connected' };
  }

  private async readConnectionState(instance: string, apiKey: string): Promise<string | null> {
    try {
      const res = await this.request(
        'GET',
        `/instance/connectionState/${this.instancePath(instance)}`,
        apiKey,
      );
      return res?.instance?.state || res?.state || 'close';
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        throw this.evolutionUnavailableException(err);
      }
      this.logger.debug(`connectionState/${instance}: ${err?.message || err}`);
      return null;
    }
  }

  /** Consulta el estado de conexion y lo persiste en el instructor. */
  async status(instructor: User): Promise<ConnectionStatus> {
    const fresh = await this.usersService.findById(instructor.id);
    const instance = this.instanceNameFor(fresh);
    const apiKey = this.adminKey();

    if (!fresh.evolutionInstance && !fresh.evolutionApiKey) {
      return { instance, state: 'close', status: 'disconnected' };
    }

    let state = 'close';
    try {
      const res = await this.request(
        'GET',
        `/instance/connectionState/${this.instancePath(instance)}`,
        apiKey,
      );
      state = res?.instance?.state || res?.state || 'close';
    } catch (err: any) {
      this.logger.warn(`connectionState/${instance}: ${err?.message || err}`);
      if (fresh.evolutionStatus === 'connected') {
        throw this.evolutionUnavailableException(err);
      }
      const fallback = fresh.evolutionStatus === 'connecting' ? 'connecting' : 'disconnected';
      return { instance, state: 'close', status: fallback };
    }

    const status = this.resolveConnectionStatus(state, fresh);

    let number = fresh.evolutionNumber;
    if (status === 'connected') {
      const meta = await this.fetchInstanceMeta(instance, apiKey);
      if (meta.number) number = meta.number;
      if (meta.apiKey) {
        await this.usersService.updateEvolutionConfig(fresh.id, { evolutionApiKey: meta.apiKey });
      }
      const webhook = this.webhookUrl();
      if (webhook) {
        await this.safeSetWebhook(instance, meta.apiKey || apiKey, webhook);
      }
    }

    await this.usersService.updateEvolutionConfig(fresh.id, {
      evolutionStatus: status,
      ...(number ? { evolutionNumber: number } : {}),
    });

    if (number) {
      await this.usersService.syncInstructorPhoneFromEvolution(fresh.id, number);
    } else if (status === 'connected') {
      this.logger.warn(
        `Instancia "${instance}" conectada pero no se pudo obtener el numero; phoneNumber del instructor no actualizado`,
      );
    } else if (status === 'disconnected') {
      await this.usersService.syncInstructorPhoneFromEvolution(fresh.id, null);
    }

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

  /** Metadatos en vivo de la instancia (token propio y numero vinculado). */
  async fetchRuntimeMeta(
    instance: string,
  ): Promise<{ apiKey?: string; ownerNumber?: string; state?: string }> {
    const apiKey = this.adminKey();
    let state: string | undefined;
    try {
      const res = await this.request(
        'GET',
        `/instance/connectionState/${this.instancePath(instance)}`,
        apiKey,
      );
      state = res?.instance?.state || res?.state;
    } catch (err: any) {
      this.logger.debug(`connectionState/${instance} en fetchRuntimeMeta: ${err?.message || err}`);
    }

    const meta = await this.fetchInstanceMeta(instance, apiKey);
    return { apiKey: meta.apiKey, ownerNumber: meta.number, state };
  }

  /** Metadatos de la instancia en Evolution (numero vinculado y apikey propia). */
  private async fetchInstanceMeta(
    instance: string,
    apiKey: string,
  ): Promise<{ number?: string; apiKey?: string }> {
    try {
      const res = await this.request(
        'GET',
        `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
        apiKey,
      );
      const list = this.normalizeInstanceList(res);
      const match =
        list.find((item) => this.instanceNameFromItem(item) === instance) ||
        (list.length === 1 ? list[0] : undefined);
      if (!match) {
        this.logger.warn(
          `fetchInstances/${instance}: instancia no encontrada (${list.length} resultado(s))`,
        );
        return {};
      }

      const number = this.extractPhoneFromItem(match);
      const instanceApiKey = this.extractApiKeyFromItem(match);

      if (!number) {
        this.logger.warn(
          `fetchInstances/${instance}: conectada pero Evolution no devolvio numero (ownerJid/owner/number)`,
        );
      }

      return { number, apiKey: instanceApiKey };
    } catch (err: any) {
      this.logger.warn(`fetchInstances/${instance}: ${err?.message || err}`);
      return {};
    }
  }

  private normalizeInstanceList(res: any): any[] {
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.instances)) return res.instances;
    if (res?.instance) return [res.instance];
    return res ? [res] : [];
  }

  private instanceNameFromItem(item: any): string | undefined {
    return item?.instance?.instanceName || item?.instanceName || item?.name || item?.instance?.name;
  }

  private extractPhoneFromItem(item: any): string | undefined {
    const direct = item?.number || item?.instance?.number;
    if (typeof direct === 'string' && direct.trim()) {
      const digits = direct.replace(/\D/g, '');
      return digits || direct.trim();
    }

    const jid =
      item?.ownerJid ||
      item?.owner ||
      item?.instance?.ownerJid ||
      item?.instance?.owner ||
      item?.instance?.wuid;
    if (typeof jid === 'string' && jid.trim()) {
      const local = jid.split('@')[0]?.replace(/\D/g, '');
      return local || undefined;
    }

    return undefined;
  }

  private extractApiKeyFromItem(item: any): string | undefined {
    return (
      item?.token ||
      item?.apikey ||
      item?.hash?.apikey ||
      item?.instance?.apikey ||
      item?.instance?.token
    );
  }

  /** Desvincula el numero (logout de la instancia). */
  async logout(instructor: User): Promise<{ instance: string; success: boolean }> {
    const fresh = await this.usersService.findById(instructor.id);
    const instance = this.instanceNameFor(fresh);
    const apiKeys = this.resolveApiKeys(fresh);

    let lastError: string | undefined;
    let evolutionLoggedOut = false;

    for (const apiKey of apiKeys) {
      try {
        await this.request('DELETE', `/instance/logout/${this.instancePath(instance)}`, apiKey);
        evolutionLoggedOut = true;
        break;
      } catch (err: any) {
        lastError = err?.message || String(err);
        this.logger.warn(
          `logout/${instance} (${apiKey === this.adminKey() ? 'admin' : 'instance'} key): ${lastError}`,
        );
        if (await this.isEvolutionSessionClosed(instance, apiKey)) {
          evolutionLoggedOut = true;
          break;
        }
      }
    }

    if (!evolutionLoggedOut) {
      for (const apiKey of apiKeys) {
        if (await this.isEvolutionSessionClosed(instance, apiKey)) {
          evolutionLoggedOut = true;
          break;
        }
      }
    }

    if (!evolutionLoggedOut) {
      throw new HttpException(
        `No se pudo desconectar WhatsApp en Evolution${lastError ? `: ${lastError}` : ''}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.usersService.updateEvolutionConfig(fresh.id, {
      evolutionStatus: 'disconnected',
      evolutionNumber: '',
    });
    await this.usersService.syncInstructorPhoneFromEvolution(fresh.id, null);
    return { instance, success: true };
  }

  /**
   * Elimina permanentemente la instancia en Evolution (logout + borrado de datos).
   * Idempotente: si la instancia no existe (404), se considera eliminada.
   */
  async deleteInstance(instanceName: string): Promise<boolean> {
    if (!instanceName?.trim()) return false;
    const instance = instanceName.trim();
    try {
      await this.request('DELETE', `/instance/delete/${this.instancePath(instance)}`, this.adminKey());
      this.logger.log(`Instancia Evolution eliminada: ${instance}`);
      return true;
    } catch (err: any) {
      if (this.isEvolutionNotFound(err)) {
        this.logger.debug(`Instancia Evolution ${instance} ya no existía (404)`);
        return true;
      }
      this.logger.warn(`No se pudo eliminar instancia Evolution ${instance}: ${err?.message || err}`);
      return false;
    }
  }

  private isEvolutionNotFound(err: unknown): boolean {
    const e = err as { message?: string };
    const msg = String(e?.message || err || '').toLowerCase();
    return msg.includes('404') || msg.includes('not found') || msg.includes('does not exist');
  }

  private async safeSetWebhook(instance: string, apiKey: string, url: string): Promise<void> {
    try {
      await this.request('POST', `/webhook/set/${this.instancePath(instance)}`, apiKey, {
        webhook: {
          enabled: true,
          url,
          base64: true,
          byEvents: false,
          events: ['MESSAGES_UPSERT'],
        },
      });
      this.logger.log(`Webhook configurado para "${instance}" -> ${url}`);
    } catch (err: any) {
      this.logger.error(`No se pudo configurar webhook para "${instance}": ${err?.message || err}`);
    }
  }

  private resolveApiKeys(instructor: User): string[] {
    const keys = [instructor.evolutionApiKey, this.adminKey()].filter(
      (key): key is string => Boolean(key?.trim()),
    );
    return [...new Set(keys)];
  }

  /** Evolution a veces responde 500 en logout aunque la sesion ya cerro; verificamos el estado real. */
  private async isEvolutionSessionClosed(instance: string, apiKey: string): Promise<boolean> {
    try {
      const res = await this.request(
        'GET',
        `/instance/connectionState/${this.instancePath(instance)}`,
        apiKey,
      );
      const state = res?.instance?.state || res?.state || 'close';
      return state !== 'open';
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return false;
      }
      this.logger.debug(
        `connectionState/${instance} tras logout fallido: ${err?.message || err}`,
      );
      return false;
    }
  }

  private async request(method: string, path: string, apiKey: string, body?: any): Promise<any> {
    const url = `${this.serverUrl()}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err: any) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.message || err;
      throw new Error(`fetch failed (${method} ${path}): ${reason}`);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Evolution ${method} ${path} -> ${res.status} ${json?.message || ''}`);
    }
    return json;
  }
}
