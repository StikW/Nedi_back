import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { AgentOrchestratorService } from '../services/agent/agent-orchestrator.service';

/**
 * Webhook publico que recibe los eventos de Evolution API (todas las
 * instancias/instructores). Responde 200 de inmediato y procesa en background
 * para no bloquear al gateway.
 */
@Controller('agent')
export class AgentWebhookController {
  private readonly logger = new Logger(AgentWebhookController.name);

  constructor(private readonly orchestrator: AgentOrchestratorService) {}

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(@Body() payload: any): { received: true } {
    const instance = payload?.instance || payload?.body?.instance || '?';
    this.logger.log(`Webhook Evolution recibido (instance=${instance})`);

    this.orchestrator.handleWebhook(payload).catch((err: any) => {
      this.logger.error(`Error procesando webhook (${instance}): ${err?.message || err}`, err?.stack);
    });
    return { received: true };
  }
}
