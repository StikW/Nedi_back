import { Injectable, Logger } from '@nestjs/common';

interface Pending {
  parts: string[];
  timer: NodeJS.Timeout;
}

/**
 * Buffer/debounce de mensajes entrantes por (instancia+telefono). Reemplaza los
 * nodos `buffer` + `Wait` + concatenacion de n8n: si el estudiante envia varios
 * mensajes seguidos, se agrupan y se procesan como uno solo.
 */
@Injectable()
export class MessageBufferService {
  private readonly logger = new Logger(MessageBufferService.name);
  private readonly pending = new Map<string, Pending>();

  /**
   * Agrega un fragmento al buffer. Cuando transcurren `debounceMs` sin nuevos
   * mensajes, ejecuta `onFlush` con el texto concatenado.
   */
  push(key: string, text: string, debounceMs: number, onFlush: (concat: string) => Promise<void>): void {
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.parts.push(text);
    }
    const parts = existing ? existing.parts : [text];

    const timer = setTimeout(() => {
      this.pending.delete(key);
      const concat = parts.filter((p) => p && p.trim()).join('\n').trim();
      onFlush(concat).catch((err) =>
        this.logger.error(`Error procesando buffer ${key}: ${err?.message || err}`),
      );
    }, debounceMs);

    this.pending.set(key, { parts, timer });
  }
}
