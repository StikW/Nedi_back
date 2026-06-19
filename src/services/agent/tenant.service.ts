import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users.service';
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
    const storedKey = (instructor.evolutionApiKey || '').trim();

    // Como n8n: priorizar la apikey de la instancia (webhook > guardada > admin)
    const apiKeys = [...new Set([webhookKey, storedKey, adminKey].filter(Boolean))];
    if (apiKeys.length === 0) {
      this.logger.error(`Sin apikey para enviar mensajes en instancia "${instance}"`);
      return null;
    }

    if (webhookKey && webhookKey !== storedKey && webhookKey !== adminKey) {
      this.usersService
        .updateEvolutionConfig(instructor.id, { evolutionApiKey: webhookKey })
        .catch((err) =>
          this.logger.warn(
            `No se pudo persistir evolutionApiKey para ${instance}: ${err?.message || err}`,
          ),
        );
    }

    this.logger.debug(
      `[${instance}] apikeys disponibles=${apiKeys.length} (webhook=${!!webhookKey}, stored=${!!storedKey}, admin=${!!adminKey})`,
    );

    return {
      instructor,
      evolution: {
        serverUrl,
        instance,
        apiKey: apiKeys[0],
        apiKeys,
      },
    };
  }
}
