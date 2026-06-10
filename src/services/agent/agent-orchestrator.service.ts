import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantService } from './tenant.service';
import { EvolutionService } from './evolution.service';
import { MediaService } from './media.service';
import { MemoryService } from './memory.service';
import { MessageBufferService } from './message-buffer.service';
import { AgentStateService } from './agent-state.service';
import { AgentsService, RuntimeContext } from './agents.service';
import { ParsedIncomingMessage, TenantContext } from './agent.types';

/**
 * Orquestador del agente Nedi. Punto de entrada del webhook de Evolution:
 *   parse -> resolver tenant -> media a texto -> buffer -> clasificar ->
 *   agente -> enviar respuesta.
 *
 * Reemplaza la columna vertebral del workflow principal de n8n.
 */
@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);
  /** Dedupe de messageId procesados (evita reprocesar reintentos del webhook). */
  private readonly processedIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantService: TenantService,
    private readonly evolution: EvolutionService,
    private readonly media: MediaService,
    private readonly memory: MemoryService,
    private readonly buffer: MessageBufferService,
    private readonly agentState: AgentStateService,
    private readonly agents: AgentsService,
  ) {}

  /** Procesa el payload del webhook (se invoca de forma asincrona). */
  async handleWebhook(payload: any): Promise<void> {
    const parsed = this.parse(payload);
    if (!parsed) return;

    // Idempotencia
    if (parsed.messageId) {
      if (this.processedIds.has(parsed.messageId)) return;
      this.processedIds.add(parsed.messageId);
      if (this.processedIds.size > 5000) {
        // Evitar crecimiento ilimitado
        this.processedIds.clear();
      }
    }

    const tenant = await this.tenantService.resolve(parsed.instance, parsed.apikey);
    if (!tenant) {
      this.logger.warn(
        `Webhook ignorado: sin instructor para instance="${parsed.instance}" phone=${parsed.phoneNumber}`,
      );
      return;
    }

    // Convertir media a texto (audio/imagen)
    const text = await this.toText(tenant, parsed);
    if (!text || !text.trim()) {
      this.logger.debug(
        `[${parsed.instance}] Mensaje sin texto (type=${parsed.messageType}) de ${parsed.phoneNumber}`,
      );
      return;
    }

    const key = `${parsed.instance}:${parsed.phoneNumber}`;
    const debounceMs = (this.configService.get<number>('AGENT_BUFFER_SECONDS') || 5) * 1000;
    const recipientJid = parsed.recipientJid;

    this.logger.log(
      `[${parsed.instance}] Mensaje de ${parsed.phoneNumber}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
    );

    this.buffer.push(key, text, debounceMs, async (concat) => {
      await this.process(tenant, parsed.phoneNumber, concat, recipientJid);
    });
  }

  /** Nucleo: clasifica y ejecuta el agente correspondiente. */
  private async process(
    tenant: TenantContext,
    phoneNumber: string,
    message: string,
    recipientJid: string,
  ): Promise<void> {
    if (!message.trim()) return;
    const instance = tenant.evolution.instance;

    const sessionTimeoutMin =
      this.configService.get<number>('AGENT_SESSION_TIMEOUT_MINUTES') ?? 20;

    let state = await this.agentState.getState(instance, phoneNumber);
    const sessionExpired = this.agentState.isSessionExpired(state, sessionTimeoutMin);
    const welcomeReason = !state
      ? 'sin sesion previa'
      : state.lastSessionAt
        ? 'sesion expirada'
        : 'sin marca de sesion';

    if (sessionExpired) {
      this.memory.clear(instance, phoneNumber);
    }

    if (!state) {
      state = await this.agentState.upsertState(instance, phoneNumber, tenant.instructor.id, {
        flujo: 'conversacion',
      });
    }

    const ctx: RuntimeContext = {
      tenant,
      phoneNumber,
      recipientJid,
      state,
      message,
      history: this.memory.get(instance, phoneNumber),
    };

    let reply = '';

    try {
      reply = await this.runWithTypingIndicator(tenant, recipientJid || phoneNumber, async () => {
        if (sessionExpired) {
          this.logger.log(
            `[${instance}] ${phoneNumber} -> AI_ConversacionInicial (${welcomeReason}, timeout=${sessionTimeoutMin}m)`,
          );
          return this.agents.runConversacionInicial(ctx);
        }

        const route = await this.agents.classify(ctx);
        this.logger.log(`[${instance}] ${phoneNumber} -> ${route} (flujo=${ctx.state.flujo})`);

        switch (route) {
          case 'AI_Preguntas':
            return this.agents.runPreguntas(ctx);
          case 'AI_Respuestas':
            return this.agents.runRespuestas(ctx);
          case 'AI_Explicar':
            return this.agents.runExplicar(ctx);
          case 'AI_Conversacion':
          default:
            return this.agents.runConversacion(ctx);
        }
      });
    } catch (err: any) {
      this.logger.error(`Error en agente: ${err?.message || err}`);
      reply = 'Disculpa, tuve un inconveniente procesando tu mensaje. ¿Puedes intentarlo de nuevo?';
    }

    if (!reply || !reply.trim()) {
      reply = '¿En qué puedo ayudarte con tu aprendizaje?';
    }

    await this.send(tenant, phoneNumber, reply, recipientJid);
    this.memory.append(instance, phoneNumber, message, reply);
    state = await this.agentState.upsertState(instance, phoneNumber, tenant.instructor.id, {
      lastSessionAt: new Date().toISOString(),
    });
  }

  /**
   * Muestra "escribiendo..." una sola vez al iniciar el procesamiento del agente.
   */
  private async runWithTypingIndicator<T>(
    tenant: TenantContext,
    to: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const delayMs = this.configService.get<number>('AGENT_TYPING_DELAY_MS') ?? 3000;
    void this.evolution.sendTyping(tenant.evolution, to, delayMs);
    return work();
  }

  /** Envia la respuesta al estudiante por Evolution. */
  private async send(
    tenant: TenantContext,
    phoneNumber: string,
    reply: string,
    recipientJid: string,
  ): Promise<void> {
    try {
      await this.evolution.sendText(tenant.evolution, recipientJid || phoneNumber, reply);
    } catch (err: any) {
      this.logger.error(`No se pudo enviar respuesta a ${phoneNumber}: ${err?.message || err}`);
    }
  }

  /** Convierte audio/imagen a texto; devuelve el texto del mensaje. */
  private async toText(tenant: TenantContext, parsed: ParsedIncomingMessage): Promise<string> {
    const type = parsed.messageType;
    if (type === 'audioMessage') {
      const base64 = await this.evolution.getBase64FromMediaMessage(tenant.evolution, parsed.raw);
      if (!base64) return '';
      return this.media.transcribeAudio(base64, 'audio/ogg');
    }
    if (type === 'imageMessage') {
      const base64 = await this.evolution.getBase64FromMediaMessage(tenant.evolution, parsed.raw);
      const caption = parsed.raw?.message?.imageMessage?.caption || '';
      if (!base64) return caption;
      const description = await this.media.analyzeImage(base64, 'image/jpeg');
      return [caption, description].filter(Boolean).join('\n');
    }
    return parsed.message;
  }

  /**
   * Normaliza el payload de Evolution (event MESSAGES_UPSERT). Equivale al
   * nodo `parser` de n8n (incluye remoteJidAlt para contactos @lid).
   */
  private parse(payload: any): ParsedIncomingMessage | null {
    const root = payload?.body || payload;
    const rawData = root?.data ?? root;
    const data = Array.isArray(rawData) ? rawData[0] : rawData;
    const key = data?.key;
    if (!key) return null;

    // Ignorar mensajes propios y de grupos
    if (key.fromMe) return null;
    const remoteJid: string = key.remoteJid || '';
    if (remoteJid.endsWith('@g.us')) return null;

    const remoteJidAlt: string = key.remoteJidAlt || '';
    const usePrimaryJid = remoteJid.includes('s.whatsapp.net');
    const recipientJid = usePrimaryJid ? remoteJid : remoteJidAlt || remoteJid;
    const phoneNumber = recipientJid.split('@')[0];
    if (!phoneNumber) return null;

    const instance = root?.instance || payload?.instance || data?.instance || '';
    const apikey = root?.apikey || payload?.apikey || data?.apikey || '';
    const messageType = data?.messageType || '';

    const msg = data?.message || {};
    let text = '';
    if (msg.conversation) text = msg.conversation;
    else if (msg.extendedTextMessage?.text) text = msg.extendedTextMessage.text;
    else if (msg.imageMessage?.caption) text = msg.imageMessage.caption;

    return {
      phoneNumber,
      recipientJid,
      message: text,
      messageType: messageType || (msg.conversation ? 'conversation' : ''),
      instance,
      apikey,
      messageId: key.id,
      raw: data,
    };
  }
}
