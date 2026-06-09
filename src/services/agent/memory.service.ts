import { Injectable } from '@nestjs/common';
import { ChatTurn } from './llm.service';

/**
 * Memoria conversacional corta por (instancia+telefono). Reemplaza los nodos
 * `memoryBufferWindow` de n8n con una unica ventana compartida por conversacion.
 *
 * In-memory por proceso. Para multi-instancia se podria respaldar en Redis,
 * pero el comportamiento del usuario es identico.
 */
@Injectable()
export class MemoryService {
  private readonly store = new Map<string, ChatTurn[]>();
  private readonly windowSize = 12;

  private key(instance: string, phone: string): string {
    return `${instance}:${phone}`;
  }

  get(instance: string, phone: string): ChatTurn[] {
    return this.store.get(this.key(instance, phone)) || [];
  }

  append(instance: string, phone: string, user: string, assistant: string): void {
    const k = this.key(instance, phone);
    const arr = this.store.get(k) || [];
    arr.push({ role: 'user', content: user });
    arr.push({ role: 'assistant', content: assistant });
    // Mantener solo la ventana mas reciente
    while (arr.length > this.windowSize) arr.shift();
    this.store.set(k, arr);
  }

  clear(instance: string, phone: string): void {
    this.store.delete(this.key(instance, phone));
  }
}
