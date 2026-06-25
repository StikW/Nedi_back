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
import { AgentActivityLogService } from '../../core/logging/agent-activity-log.service';

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
    private readonly activityLog: AgentActivityLogService,
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
      this.activityLog.record({
        level: 'warn',
        instance: parsed.instance || '?',
        phoneNumber: parsed.phoneNumber,
        direction: 'in',
        event: 'webhook_ignored',
        detail: 'Sin instructor para la instancia',
      });
      return;
    }

    this.warnIfInstructorSelfChat(tenant, parsed.phoneNumber);

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

    this.logger.log(
      `[${parsed.instance}] Mensaje de ${parsed.phoneNumber}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}" (linea instructor: ${tenant.liveOwnerNumber || tenant.instructor.evolutionNumber || tenant.instructor.phoneNumber || '?'})`,
    );
    this.activityLog.record({
      level: 'info',
      instance: parsed.instance,
      phoneNumber: parsed.phoneNumber,
      direction: 'in',
      event: 'message_received',
      messagePreview: text.slice(0, 160),
    });
    this.logger.debug(
      `[${parsed.instance}] JIDs remote=${parsed.remoteJid} alt=${parsed.remoteJidAlt} replyTo=${parsed.replyToJid} senderPn=${parsed.senderPn || '-'}`,
    );

    this.buffer.push(key, text, debounceMs, async (concat) => {
      const freshTenant = await this.tenantService.resolve(parsed.instance, parsed.apikey);
      if (!freshTenant) {
        this.logger.error(
          `[${parsed.instance}] No se pudo re-resolver tenant antes de responder a ${parsed.phoneNumber}`,
        );
        return;
      }
      await this.process(freshTenant, parsed, concat);
    });
  }

  private warnIfInstructorSelfChat(tenant: TenantContext, phoneNumber: string): void {
    const instructorDigits = (
      tenant.liveOwnerNumber ||
      tenant.instructor.evolutionNumber ||
      tenant.instructor.phoneNumber ||
      ''
    ).replace(/[^0-9]/g, '');
    const senderDigits = phoneNumber.replace(/[^0-9]/g, '');
    if (instructorDigits && senderDigits && instructorDigits === senderDigits) {
      this.logger.warn(
        `[${tenant.evolution.instance}] El remitente ${phoneNumber} es el mismo numero vinculado al instructor; WhatsApp puede mostrar "escribiendo" pero no entregar respuestas. Prueba desde otro telefono.`,
      );
      this.activityLog.record({
        level: 'warn',
        instance: tenant.evolution.instance,
        phoneNumber,
        direction: 'in',
        event: 'self_chat',
        detail: `Remitente=${senderDigits} coincide con linea instructor=${instructorDigits}`,
      });
    }
  }

  /** Nucleo: clasifica y ejecuta el agente correspondiente. */
  private async process(
    tenant: TenantContext,
    parsed: ParsedIncomingMessage,
    message: string,
  ): Promise<void> {
    if (!message.trim()) return;
    const instance = tenant.evolution.instance;
    const phoneNumber = parsed.phoneNumber;

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
      if (state) {
        state = await this.agentState.upsertState(instance, phoneNumber, state.instructorId, {
          awaitingModuleStartConfirmation: false,
          awaitingCourseStartConfirmation: false,
          introShownForModuleId: undefined,
          nediIntroShown: false,
        });
      }
    }

    if (!state) {
      state = await this.agentState.upsertState(instance, phoneNumber, tenant.instructor.id, {
        flujo: 'conversacion',
      });
    }

    const ctx: RuntimeContext = {
      tenant,
      phoneNumber,
      recipientJid: parsed.recipientJid,
      state,
      message,
      history: this.memory.get(instance, phoneNumber),
    };

    let reply = '';

    try {
      if (sessionExpired) {
        this.logger.log(
          `[${instance}] ${phoneNumber} -> AI_ConversacionInicial (${welcomeReason}, timeout=${sessionTimeoutMin}m)`,
        );
        reply = await this.agents.runConversacionInicial(ctx);
      } else {
        const route = await this.agents.classify(ctx);
        this.logger.log(`[${instance}] ${phoneNumber} -> ${route} (flujo=${ctx.state.flujo})`);

        switch (route) {
          case 'AI_Preguntas':
            reply = await this.agents.runPreguntas(ctx);
            break;
          case 'AI_Respuestas':
            reply = await this.agents.runRespuestas(ctx);
            break;
          case 'AI_Explicar':
            reply = await this.agents.runExplicar(ctx);
            break;
          case 'AI_Conversacion':
          default:
            reply = await this.agents.runConversacion(ctx);
            break;
        }
      }
    } catch (err: any) {
      this.logger.error(`Error en agente: ${err?.message || err}`);
      this.activityLog.record({
        level: 'error',
        instance,
        phoneNumber,
        event: 'agent_error',
        detail: err?.message || String(err),
      });
      reply = 'Disculpa, tuve un inconveniente procesando tu mensaje. ¿Puedes intentarlo de nuevo?';
    }

    if (!reply || !reply.trim()) {
      reply = '¿En qué puedo ayudarte con tu aprendizaje?';
    }

    const presenceDelayMs = this.configService.get<number>('AGENT_TYPING_DELAY_MS') ?? 2000;
    await this.send(tenant, parsed, reply, presenceDelayMs);
    this.memory.append(instance, phoneNumber, message, reply);
    state = await this.agentState.upsertState(instance, phoneNumber, tenant.instructor.id, {
      lastSessionAt: new Date().toISOString(),
      ...(sessionExpired ? { nediIntroShown: true } : {}),
    });
  }

  /** Envia la respuesta de texto; la burbuja "escribiendo..." se muestra justo antes. */
  private async send(
    tenant: TenantContext,
    parsed: ParsedIncomingMessage,
    reply: string,
    presenceDelayMs: number,
  ): Promise<void> {
    const replyTargets = this.evolution.buildReplyTargets(parsed);
    const instructorLine =
      tenant.liveOwnerNumber ||
      tenant.instructor.evolutionNumber ||
      tenant.instructor.phoneNumber ||
      '?';

    try {
      const result = await this.evolution.sendText(
        tenant.evolution,
        replyTargets,
        reply,
        presenceDelayMs,
        { linkPreview: false },
      );
      this.logger.log(
        `[${tenant.evolution.instance}] Respuesta enviada desde linea ${instructorLine} hacia ${result.numberUsed} (${reply.length} chars, msgId=${result.messageId || '?'})`,
      );
      this.activityLog.record({
        level: 'info',
        instance: tenant.evolution.instance,
        phoneNumber: parsed.phoneNumber,
        direction: 'out',
        event: 'message_sent',
        messagePreview: reply.slice(0, 160),
        detail: `to=${result.numberUsed} msgId=${result.messageId || '?'}`,
      });
    } catch (err: any) {
      this.logger.error(
        `[${tenant.evolution.instance}] No se pudo enviar desde linea ${instructorLine} hacia ${parsed.replyToJid}: ${err?.message || err}`,
      );
      this.activityLog.record({
        level: 'error',
        instance: tenant.evolution.instance,
        phoneNumber: parsed.phoneNumber,
        direction: 'out',
        event: 'send_failed',
        messagePreview: reply.slice(0, 160),
        detail: `to=${parsed.replyToJid} ${err?.message || String(err)}`,
      });
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
    const senderPn: string = key.senderPn || data?.senderPn || '';

    // n8n: si remoteJid tiene @s.whatsapp.net usarlo; si no, remoteJidAlt o senderPn
    const replyToJid = remoteJid.includes('@s.whatsapp.net')
      ? remoteJid
      : remoteJidAlt.includes('@s.whatsapp.net')
        ? remoteJidAlt
        : senderPn
          ? `${senderPn.replace(/[^0-9]/g, '')}@s.whatsapp.net`
          : remoteJidAlt || remoteJid;

    let recipientJid: string;
    if (remoteJid.includes('@s.whatsapp.net')) {
      recipientJid = remoteJid;
    } else if (remoteJidAlt.includes('@s.whatsapp.net')) {
      recipientJid = remoteJidAlt;
    } else if (senderPn) {
      const digits = senderPn.replace(/[^0-9]/g, '');
      recipientJid = digits ? `${digits}@s.whatsapp.net` : remoteJidAlt || remoteJid;
    } else {
      recipientJid = remoteJidAlt || remoteJid;
    }

    const phoneNumber = recipientJid.split('@')[0].replace(/[^0-9]/g, '');
    if (!phoneNumber || phoneNumber.length < 10) {
      this.logger.warn(
        `JID no resuelto a telefono valido remoteJid=${remoteJid} alt=${remoteJidAlt} senderPn=${senderPn}`,
      );
      return null;
    }

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
      remoteJid,
      remoteJidAlt,
      replyToJid,
      senderPn: senderPn || undefined,
      message: text,
      messageType: messageType || (msg.conversation ? 'conversation' : ''),
      instance,
      apikey,
      messageId: key.id,
      raw: data,
    };
  }
}
