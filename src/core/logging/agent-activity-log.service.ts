import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export type AgentActivityLevel = 'info' | 'warn' | 'error';

export interface AgentActivityEntry {
  id: string;
  timestamp: string;
  level: AgentActivityLevel;
  instance: string;
  phoneNumber?: string;
  direction?: 'in' | 'out';
  event: string;
  detail?: string;
  messagePreview?: string;
}

/**
 * Buffer circular en memoria de actividad del agente (sin BD).
 * Alimenta el panel admin de logs y complementa los archivos en disco.
 */
@Injectable()
export class AgentActivityLogService {
  private readonly entries: AgentActivityEntry[] = [];
  private readonly maxEntries: number;

  constructor(private readonly configService: ConfigService) {
    this.maxEntries = this.configService.get<number>('env.agentActivityLogMax') ?? 500;
  }

  record(partial: Omit<AgentActivityEntry, 'id' | 'timestamp'>): AgentActivityEntry {
    const entry: AgentActivityEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...partial,
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    return entry;
  }

  list(options: { limit?: number; level?: AgentActivityLevel; instance?: string } = {}): AgentActivityEntry[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), this.maxEntries);
    return this.entries
      .filter((entry) => (options.level ? entry.level === options.level : true))
      .filter((entry) => (options.instance ? entry.instance === options.instance : true))
      .slice(0, limit);
  }

  /** Agrupa conversaciones recientes por teléfono (fallback cuando Evolution findChats no responde). */
  recentConversations(
    instance: string,
    limit = 60,
  ): Array<{
    phoneNumber: string;
    lastMessageAt: string;
    lastMessagePreview?: string;
    lastDirection?: 'in' | 'out';
  }> {
    const relevant = this.entries.filter(
      (entry) =>
        entry.instance === instance &&
        entry.phoneNumber &&
        (entry.event === 'message_received' ||
          entry.event === 'message_sent' ||
          entry.event === 'send_failed'),
    );

    const byPhone = new Map<
      string,
      { phoneNumber: string; lastMessageAt: string; lastMessagePreview?: string; lastDirection?: 'in' | 'out' }
    >();

    for (const entry of relevant) {
      const phone = entry.phoneNumber!.replace(/[^0-9]/g, '');
      if (phone.length < 10) continue;

      const existing = byPhone.get(phone);
      if (
        !existing ||
        Date.parse(entry.timestamp) > Date.parse(existing.lastMessageAt)
      ) {
        byPhone.set(phone, {
          phoneNumber: phone,
          lastMessageAt: entry.timestamp,
          lastMessagePreview: entry.messagePreview,
          lastDirection: entry.direction,
        });
      }
    }

    return [...byPhone.values()]
      .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
      .slice(0, limit);
  }

  /** Mensajes reconstruidos desde el buffer (entrada/salida del agente). */
  messagesForPhone(instance: string, phoneNumber: string): AgentActivityEntry[] {
    const digits = phoneNumber.replace(/[^0-9]/g, '');
    return this.entries
      .filter(
        (entry) =>
          entry.instance === instance &&
          entry.phoneNumber?.replace(/[^0-9]/g, '') === digits &&
          (entry.event === 'message_received' ||
            entry.event === 'message_sent' ||
            entry.event === 'send_failed'),
      )
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
}
