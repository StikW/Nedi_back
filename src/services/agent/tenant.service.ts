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

    // Token en vivo desde Evolution (evita quedar con admin key guardada por error)
    let liveOwnerNumber: string | undefined;
    try {
      const live = await this.evolutionAdmin.fetchRuntimeMeta(instance);
      liveOwnerNumber = live.ownerNumber;
      const liveKey = (live.apiKey || '').trim();
      if (liveKey && liveKey !== adminKey && liveKey !== storedKey) {
        storedKey = liveKey;
        this.usersService
          .updateEvolutionConfig(instructor.id, { evolutionApiKey: liveKey })
          .catch((err) =>
            this.logger.warn(
              `No se pudo persistir evolutionApiKey (live) para ${instance}: ${err?.message || err}`,
            ),
          );
      }
    } catch (err: any) {
      this.logger.warn(`fetchRuntimeMeta/${instance}: ${err?.message || err}`);
    }

    // Orden n8n: live/guardada > webhook > admin (admin solo fallback)
    const apiKeys = [...new Set([storedKey, webhookKey, adminKey].filter(Boolean))];
    if (apiKeys.length === 0) {
      this.logger.error(`Sin apikey para enviar mensajes en instancia "${instance}"`);
      return null;
    }

    if (webhookKey && webhookKey !== adminKey && webhookKey !== storedKey) {
      this.usersService
        .updateEvolutionConfig(instructor.id, { evolutionApiKey: webhookKey })
        .catch((err) =>
          this.logger.warn(
            `No se pudo persistir evolutionApiKey para ${instance}: ${err?.message || err}`,
          ),
        );
    }

    this.logger.debug(
      `[${instance}] apikeys=${apiKeys.length} liveOwner=${liveOwnerNumber || '?'} (stored=${!!storedKey}, webhook=${!!webhookKey}, admin=${!!adminKey})`,
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
