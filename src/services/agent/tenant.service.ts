import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users.service';
import { EvolutionAdminService } from './evolution-admin.service';
import { TenantContext } from './agent.types';

/**
 * Resuelve el instructor (tenant) y su configuracion de Evolution a partir de
 * los datos del webhook entrante (`instance` + `apikey`).
 *
 * Reemplaza el modelo de n8n de "un workflow por instructor": aqui un solo
 * servicio atiende a todos los instructores, scoping todo por el tenant resuelto.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly evolutionAdmin: EvolutionAdminService,
  ) {}

  /**
   * @param instance nombre de la instancia que recibio el mensaje
   * @param apikey   apikey enviada por Evolution en el webhook (por instancia)
   */
  async resolve(instance: string, apikey?: string): Promise<TenantContext | null> {
    const instructor = await this.usersService.findByEvolutionInstance(instance);
    if (!instructor) {
      this.logger.warn(`No se encontro instructor para la instancia Evolution "${instance}"`);
      return null;
    }

    const serverUrl = this.configService.get<string>('EVOLUTION_SERVER_URL') || '';
    const adminKey = (this.configService.get<string>('EVOLUTION_ADMIN_API_KEY') || '').trim();
    const webhookKey = (apikey || '').trim();
    let storedKey = (instructor.evolutionApiKey || '').trim();
    if (storedKey && adminKey && storedKey === adminKey) {
      storedKey = '';
    }

    // Token en vivo desde Evolution (evita quedar con admin key guardada por error)
    let liveOwnerNumber: string | undefined;
    let liveKey = '';
    try {
      const live = await this.evolutionAdmin.fetchRuntimeMeta(instance);
      liveOwnerNumber = live.ownerNumber;
      liveKey = (live.apiKey || '').trim();
      if (liveKey && adminKey && liveKey === adminKey) {
        liveKey = '';
      }
      const keyToPersist = liveKey || (webhookKey && webhookKey !== adminKey ? webhookKey : '');
      if (keyToPersist && keyToPersist !== (instructor.evolutionApiKey || '').trim()) {
        storedKey = keyToPersist;
        this.usersService
          .updateEvolutionConfig(instructor.id, { evolutionApiKey: keyToPersist })
          .catch((err) =>
            this.logger.warn(
              `No se pudo persistir evolutionApiKey (live) para ${instance}: ${err?.message || err}`,
            ),
          );
      }
    } catch (err: any) {
      this.logger.warn(`fetchRuntimeMeta/${instance}: ${err?.message || err}`);
    }

    // n8n envia con la apikey del webhook; nunca la admin (puede devolver 200 sin entregar).
    const apiKeys = [
      ...new Set(
        [webhookKey, liveKey, storedKey].filter(
          (key) => key && (!adminKey || key !== adminKey),
        ),
      ),
    ];
    if (apiKeys.length === 0) {
      this.logger.error(
        `Sin apikey de instancia para enviar mensajes en "${instance}" (solo admin o vacia)`,
      );
      return null;
    }

    this.logger.debug(
      `[${instance}] apikeys=${apiKeys.length} liveOwner=${liveOwnerNumber || '?'} (webhook=${!!webhookKey}, live=${!!liveKey}, stored=${!!storedKey})`,
    );

    return {
      instructor,
      liveOwnerNumber,
      evolution: {
        serverUrl,
        instance,
        apiKey: apiKeys[0],
        apiKeys,
      },
    };
  }
}
