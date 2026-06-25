import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Logger de NestJS que además persiste en disco (logs/nedi-YYYY-MM-DD.log).
 */
export class FileConsoleLogger extends ConsoleLogger {
  private readonly logPath: string;

  constructor(
    private readonly enabledLevels: LogLevel[],
    logDir: string,
  ) {
    super();
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    this.logPath = join(logDir, `nedi-${date}.log`);
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabledLevels.includes(level);
  }

  private writeToFile(level: string, message: string, context?: string): void {
    const ctx = context ? `[${context}] ` : '';
    const line = `${new Date().toISOString()} [${level}] ${ctx}${message}\n`;
    try {
      appendFileSync(this.logPath, line, 'utf8');
    } catch {
      // No bloquear la app si falla el disco
    }
  }

  log(message: any, context?: string): void {
    if (!this.shouldLog('log')) return;
    super.log(message, context);
    this.writeToFile('LOG', this.toLine(message), context);
  }

  error(message: any, stack?: string, context?: string): void {
    if (!this.shouldLog('error')) return;
    super.error(message, stack, context);
    const detail = stack ? `${this.toLine(message)}\n${stack}` : this.toLine(message);
    this.writeToFile('ERROR', detail, context);
  }

  warn(message: any, context?: string): void {
    if (!this.shouldLog('warn')) return;
    super.warn(message, context);
    this.writeToFile('WARN', this.toLine(message), context);
  }

  debug(message: any, context?: string): void {
    if (!this.shouldLog('debug')) return;
    super.debug(message, context);
    this.writeToFile('DEBUG', this.toLine(message), context);
  }

  verbose(message: any, context?: string): void {
    if (!this.shouldLog('verbose')) return;
    super.verbose(message, context);
    this.writeToFile('VERBOSE', this.toLine(message), context);
  }

  private toLine(message: any): string {
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}

export function parseLogLevels(raw?: string): LogLevel[] {
  const all: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  if (!raw?.trim()) {
    return ['error', 'warn', 'log', 'debug'];
  }
  const requested = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean) as LogLevel[];
  if (requested.includes('all' as LogLevel)) return all;
  return requested.filter((level) => all.includes(level));
}
