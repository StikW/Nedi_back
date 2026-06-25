import { Injectable, Logger, NotFoundException, BadGatewayException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users.service';
import { EvolutionService } from '../agent/evolution.service';
import { EvolutionAdminService } from '../agent/evolution-admin.service';
import { EvolutionConfig } from '../agent/agent.types';
import { UserRole } from '../../models/user.entity';
import { AgentActivityLogService } from '../../core/logging/agent-activity-log.service';

export interface InstructorConversationSummary {
  id: string;
  name: string;
  email: string;
  evolutionInstance?: string;
  evolutionNumber?: string;
  evolutionStatus?: string;
  connectionState?: string;
}

export interface ChatSummary {
  remoteJid: string;
  phoneNumber: string;
  pushName?: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  /** evolution = historial en Evolution API; activity_log = buffer del agente en memoria */
  source?: 'evolution' | 'activity_log';
}

export interface ChatMessageView {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  messageType: string;
  text: string;
  timestamp: string;
  pushName?: string;
}

@Injectable()
export class ConversationHistoryService {
  private readonly logger = new Logger(ConversationHistoryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly evolution: EvolutionService,
    private readonly evolutionAdmin: EvolutionAdminService,
    private readonly activityLog: AgentActivityLogService,
  ) {}

  async listInstructors(): Promise<InstructorConversationSummary[]> {
    const { users } = await this.usersService.listUsers(200);

    return users
      .filter((user) => user.role === UserRole.INSTRUCTOR)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        evolutionInstance: user.evolutionInstance || `nedi_${user.id}`,
        evolutionNumber: user.evolutionNumber,
        evolutionStatus: user.evolutionStatus,
        connectionState:
          user.evolutionStatus === 'connected'
            ? 'open'
            : user.evolutionStatus === 'connecting'
              ? 'connecting'
              : 'close',
      }))
      .sort((a, b) => {
        const rank = (item: InstructorConversationSummary) => {
          if (item.connectionState === 'open' || item.evolutionStatus === 'connected') return 0;
          if (item.evolutionStatus === 'connecting') return 1;
          return 2;
        };
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
  }

  async listChats(instructorId: string): Promise<ChatSummary[]> {
    try {
      const cfg = await this.resolveEvolutionConfig(instructorId);
      try {
        const rawChats = await this.evolution.findChats(cfg);
        const chats = this.mapAndSortChats(rawChats).map((chat) => ({
          ...chat,
          source: 'evolution' as const,
        }));
        if (chats.length > 0) {
          return chats;
        }
        this.logger.debug(
          `findChats/${cfg.instance} devolvio 0 chats; usando activity log como fallback`,
        );
      } catch (err: any) {
        this.logger.warn(
          `findChats/${cfg.instance} no disponible (${err?.message || err}); usando activity log`,
        );
      }

      const fromLog = this.listChatsFromActivityLog(cfg.instance);
      if (fromLog.length === 0) {
        throw new BadGatewayException(
          `Evolution no devolvió chats y aún no hay conversaciones en el buffer del agente para "${cfg.instance}". ` +
            'Envía un mensaje al agente y vuelve a intentar, o revisa la conectividad con Evolution.',
        );
      }
      return fromLog;
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`listChats/${instructorId}: ${err?.message || err}`);
      throw new BadGatewayException(
        `No se pudieron cargar los chats: ${err?.message || err}`,
      );
    }
  }

  async listMessages(
    instructorId: string,
    remoteJid: string,
    page = 1,
    offset = 50,
  ): Promise<{ messages: ChatMessageView[]; total?: number; pages?: number; currentPage?: number }> {
    try {
      const cfg = await this.resolveEvolutionConfig(instructorId);
      const normalizedJid = this.normalizeRemoteJid(remoteJid);
      const phoneDigits = normalizedJid.split('@')[0].replace(/[^0-9]/g, '');

      try {
        const result = await this.evolution.findMessages(cfg, normalizedJid, page, offset);
        if (result.records.length > 0) {
          const messages = result.records
            .map((record: any) => this.mapMessage(record, normalizedJid))
            .filter((msg): msg is ChatMessageView => Boolean(msg))
            .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

          return {
            messages,
            total: result.total,
            pages: result.pages,
            currentPage: result.currentPage ?? page,
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `findMessages/${cfg.instance}/${phoneDigits}: ${err?.message || err}; usando activity log`,
        );
      }

      const messages = this.listMessagesFromActivityLog(cfg.instance, phoneDigits);
      return { messages, currentPage: 1, pages: 1, total: messages.length };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`listMessages/${instructorId}: ${err?.message || err}`);
      throw new BadGatewayException(
        `No se pudieron cargar los mensajes desde Evolution: ${err?.message || err}`,
      );
    }
  }

  private async resolveEvolutionConfig(instructorId: string): Promise<EvolutionConfig> {
    const instructor = await this.usersService.findById(instructorId);
    if (!instructor || instructor.role !== UserRole.INSTRUCTOR) {
      throw new NotFoundException('Instructor no encontrado');
    }

    const instance = instructor.evolutionInstance || `nedi_${instructor.id}`;
    const serverUrl =
      this.configService.get<string>('env.evolutionServerUrl') ||
      this.configService.get<string>('EVOLUTION_SERVER_URL') ||
      '';
    const adminKey = (
      this.configService.get<string>('env.evolutionAdminApiKey') ||
      this.configService.get<string>('EVOLUTION_ADMIN_API_KEY') ||
      ''
    ).trim();
    let storedKey = (instructor.evolutionApiKey || '').trim();
    if (storedKey && adminKey && storedKey === adminKey) {
      storedKey = '';
    }

    let liveKey = '';
    const needsLiveMeta = !storedKey && this.evolutionAdmin.isEvolutionReachable();
    if (needsLiveMeta) {
      try {
        const meta = await this.evolutionAdmin.fetchRuntimeMeta(instance);
        liveKey = (meta.apiKey || '').trim();
        if (liveKey && adminKey && liveKey === adminKey) {
          liveKey = '';
        }
        if (meta.state && meta.state !== 'open' && instructor.evolutionStatus === 'connected') {
          throw new BadGatewayException(
            `La instancia "${instance}" no está conectada (state=${meta.state}). Reconecta WhatsApp desde el panel del instructor.`,
          );
        }
      } catch (err: any) {
        if (err instanceof BadGatewayException) throw err;
      }
    }

    const instanceKeys = [
      ...new Set([liveKey, storedKey].filter((key) => key && (!adminKey || key !== adminKey))),
    ];
    const apiKeys = instanceKeys.length > 0 ? instanceKeys : adminKey ? [adminKey] : [];

    if (!serverUrl) {
      throw new BadGatewayException('EVOLUTION_SERVER_URL no configurado en el backend.');
    }
    if (apiKeys.length === 0) {
      if (!this.evolutionAdmin.isEvolutionReachable()) {
        throw new BadGatewayException(
          'Evolution API no accesible desde el backend. En local abre túnel SSH o revisa EVOLUTION_SERVER_URL.',
        );
      }
      throw new BadGatewayException(
        `Sin API key de instancia para "${instance}". Refresca el estado de WhatsApp del instructor.`,
      );
    }

    return { serverUrl, instance, apiKey: apiKeys[0], apiKeys };
  }

  private mapAndSortChats(rawChats: any[]): ChatSummary[] {
    const chats = rawChats
      .map((chat: any) => this.mapChat(chat))
      .filter((chat): chat is ChatSummary => Boolean(chat))
      .filter((chat) => !chat.remoteJid.endsWith('@g.us'))
      .filter((chat) => chat.phoneNumber.length >= 10);

    chats.sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return tb - ta;
    });

    return chats;
  }

  private listChatsFromActivityLog(instance: string): ChatSummary[] {
    return this.activityLog.recentConversations(instance).map((item) => ({
      remoteJid: `${item.phoneNumber}@s.whatsapp.net`,
      phoneNumber: item.phoneNumber,
      pushName: item.phoneNumber,
      lastMessagePreview: item.lastMessagePreview,
      lastMessageAt: item.lastMessageAt,
      source: 'activity_log' as const,
    }));
  }

  private listMessagesFromActivityLog(instance: string, phoneDigits: string): ChatMessageView[] {
    return this.activityLog.messagesForPhone(instance, phoneDigits).map((entry) => ({
      id: entry.id,
      remoteJid: `${phoneDigits}@s.whatsapp.net`,
      fromMe: entry.direction === 'out',
      messageType: entry.event === 'send_failed' ? 'error' : 'conversation',
      text:
        entry.messagePreview ||
        (entry.event === 'send_failed' ? `[Envío fallido] ${entry.detail || ''}` : ''),
      timestamp: entry.timestamp,
    }));
  }

  private mapChat(raw: any): ChatSummary | null {
    const remoteJid =
      raw?.remoteJid ||
      raw?.id ||
      raw?.jid ||
      raw?.key?.remoteJid ||
      raw?.lastMessage?.key?.remoteJid;
    if (!remoteJid || typeof remoteJid !== 'string') return null;

    const phoneNumber = this.phoneFromJid(remoteJid);
    const lastMessage = raw?.lastMessage || raw?.message;
    const lastText = lastMessage ? this.extractText(lastMessage.message || lastMessage) : '';
    const lastTs = this.extractTimestamp(lastMessage || raw);

    return {
      remoteJid,
      phoneNumber,
      pushName: raw?.pushName || raw?.name || raw?.contact?.pushName || phoneNumber,
      lastMessagePreview: lastText || undefined,
      lastMessageAt: lastTs,
      unreadCount: typeof raw?.unreadCount === 'number' ? raw.unreadCount : undefined,
    };
  }

  private mapMessage(raw: any, fallbackJid: string): ChatMessageView | null {
    const key = raw?.key || {};
    const remoteJid = key.remoteJid || raw?.remoteJid || fallbackJid;
    const id = raw?.id || key.id;
    if (!id) return null;

    const messageType = raw?.messageType || 'unknown';
    const text = this.extractText(raw?.message) || this.mediaLabel(messageType);
    const timestamp = this.extractTimestamp(raw);
    if (!timestamp) return null;

    return {
      id,
      remoteJid,
      fromMe: Boolean(key.fromMe ?? raw?.fromMe),
      messageType,
      text,
      timestamp,
      pushName: raw?.pushName,
    };
  }

  private extractText(message: any): string {
    if (!message) return '';
    if (typeof message === 'string') return message.trim();
    if (message.conversation) return String(message.conversation).trim();
    if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text).trim();
    if (message.imageMessage?.caption) return String(message.imageMessage.caption).trim();
    if (message.videoMessage?.caption) return String(message.videoMessage.caption).trim();
    if (message.buttonsResponseMessage?.selectedDisplayText) {
      return String(message.buttonsResponseMessage.selectedDisplayText).trim();
    }
    if (message.listResponseMessage?.title) {
      return String(message.listResponseMessage.title).trim();
    }
    return '';
  }

  private mediaLabel(messageType: string): string {
    switch (messageType) {
      case 'audioMessage':
        return '[Audio]';
      case 'imageMessage':
        return '[Imagen]';
      case 'videoMessage':
        return '[Video]';
      case 'documentMessage':
        return '[Documento]';
      case 'stickerMessage':
        return '[Sticker]';
      case 'locationMessage':
        return '[Ubicación]';
      case 'contactMessage':
        return '[Contacto]';
      default:
        return messageType && messageType !== 'unknown' ? `[${messageType}]` : '';
    }
  }

  private extractTimestamp(raw: any): string | undefined {
    const ts =
      raw?.messageTimestamp ||
      raw?.timestamp ||
      raw?.message?.messageTimestamp ||
      raw?.lastMessage?.messageTimestamp;
    if (ts == null) return undefined;
    const num = typeof ts === 'string' ? Number(ts) : ts;
    if (!Number.isFinite(num)) return undefined;
    const ms = num < 1e12 ? num * 1000 : num;
    return new Date(ms).toISOString();
  }

  private phoneFromJid(jid: string): string {
    return jid.split('@')[0]?.replace(/[^0-9]/g, '') || '';
  }

  private normalizeRemoteJid(remoteJid: string): string {
    const trimmed = remoteJid.trim();
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, '');
    return `${digits}@s.whatsapp.net`;
  }
}
