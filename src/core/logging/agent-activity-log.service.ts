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
}
