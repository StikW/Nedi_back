import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard que protege endpoints destinados a ser invocados por sistemas internos
 * (cron externo, EventBridge, otro servicio backend) usando una API Key compartida.
 *
 * Header esperado: `x-internal-api-key: <REMINDER_INTERNAL_API_KEY>`
 *
 * Si la variable `REMINDER_INTERNAL_API_KEY` no está configurada, el endpoint
 * queda inhabilitado (responde 503) en vez de quedar abierto al público.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.configService.get<string>('REMINDER_INTERNAL_API_KEY');
    if (!expectedKey) {
      throw new ServiceUnavailableException(
        'REMINDER_INTERNAL_API_KEY no configurada en el servidor',
      );
    }

    const request = context.switchToHttp().getRequest();
    const provided =
      request.headers['x-internal-api-key'] ||
      request.headers['X-Internal-Api-Key'] ||
      request.headers['x-api-key'];

    if (!provided || provided !== expectedKey) {
      throw new UnauthorizedException('API key interna inválida o ausente');
    }

    return true;
  }
}
