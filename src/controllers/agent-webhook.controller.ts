import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AgentOrchestratorService } from '../services/agent/agent-orchestrator.service';

/**
 * Webhook publico que recibe los eventos de Evolution API (todas las
 * instancias/instructores). Responde 200 de inmediato y procesa en background
 * para no bloquear al gateway.
 */
@Controller('agent')
export class AgentWebhookController {
  constructor(private readonly orchestrator: AgentOrchestratorService) {}

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(@Body() payload: any): { received: true } {
    // Fire-and-forget: el procesamiento (LLM, RAG, envio) ocurre async.
    this.orchestrator.handleWebhook(payload).catch(() => undefined);
    return { received: true };
  }
}
