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
   * @param apikey   apikey enviada por Evolution (se valida contra la guardada)
   */
  async resolve(instance: string, apikey?: string): Promise<TenantContext | null> {
    const instructor = await this.usersService.findByEvolutionInstance(instance);
    if (!instructor) {
      this.logger.warn(`No se encontro instructor para la instancia Evolution "${instance}"`);
      return null;
    }

    // Validacion opcional de apikey: si difiere de la guardada, seguimos con la
    // almacenada o la del payload (Evolution a veces envia la global).
    if (apikey && instructor.evolutionApiKey && instructor.evolutionApiKey !== apikey) {
      this.logger.warn(
        `apikey distinta para instancia "${instance}"; se usa la guardada o la del webhook`,
      );
    }

    const serverUrl = this.configService.get<string>('EVOLUTION_SERVER_URL') || '';
    const adminKey = this.configService.get<string>('EVOLUTION_ADMIN_API_KEY') || '';

    return {
      instructor,
      evolution: {
        serverUrl,
        instance,
        apiKey: instructor.evolutionApiKey || apikey || adminKey,
      },
    };
  }
}
