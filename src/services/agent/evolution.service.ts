import { Injectable, Logger } from '@nestjs/common';
import { EvolutionConfig } from './agent.types';

/**
 * Cliente del gateway de WhatsApp via Evolution API.
 *
 * Reemplaza los nodos `Send message`, `Send audio`, `Send media`, `get_audio`
 * y `get_image` del workflow de n8n. Toda la config (servidor, instancia,
 * apikey) llega por parametro -> nada hardcodeado, multi-instructor.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly requestTimeoutMs = 12_000;

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: apiKey,
    };
  }

  private base(cfg: EvolutionConfig): string {
    return (cfg.serverUrl || '').replace(/\/+$/, '');
  }

  private instancePath(instance: string): string {
    return encodeURIComponent(instance);
  }

  private withKey(cfg: EvolutionConfig, apiKey: string): EvolutionConfig {
    return { ...cfg, apiKey };
  }

  /** Claves propias de la instancia (webhook / live / guardada). Sin admin global. */
  private instanceKeys(cfg: EvolutionConfig): string[] {
    const keys = cfg.apiKeys?.length ? cfg.apiKeys : [cfg.apiKey];
    return [...new Set(keys.filter(Boolean))];
  }

  private allKeys(cfg: EvolutionConfig): string[] {
    const keys = cfg.apiKeys?.length ? cfg.apiKeys : [cfg.apiKey];
    return [...new Set(keys.filter(Boolean))];
  }

  private normalizeOutboundNumber(to: string): string {
    if (!to?.trim()) return to;
    const userPart = to.split('@')[0] || to;
    const digits = userPart.replace(/[^0-9]/g, '');
    if (!digits) {
      throw new Error(`Numero de destino invalido: "${to}"`);
    }
    return digits;
  }

  /** n8n enviaba el JID completo; v2 acepta digitos. Probamos el JID recibido primero. */
  private outboundNumberVariants(to: string): string[] {
    const trimmed = (to || '').trim();
    if (!trimmed) {
      throw new Error('Numero de destino invalido: vacio');
    }

    if (trimmed.includes('@')) {
      const variants = [trimmed];
      if (trimmed.endsWith('@lid')) {
        return variants;
      }
      const digits = trimmed.split('@')[0]?.replace(/[^0-9]/g, '') || '';
      if (digits.length >= 10) {
        variants.push(digits, `${digits}@s.whatsapp.net`);
      }
      return [...new Set(variants)];
    }

    const digits = this.normalizeOutboundNumber(trimmed);
    return [...new Set([digits, `${digits}@s.whatsapp.net`])];
  }

  /** JIDs a probar al responder. Prioriza @s.whatsapp.net (como n8n); @lid solo sin teléfono real. */
  buildReplyTargets(input: {
    replyToJid: string;
    remoteJid: string;
    remoteJidAlt: string;
    recipientJid: string;
    phoneNumber: string;
    senderPn?: string;
  }): string[] {
    const phoneDigits = (input.phoneNumber || '').replace(/[^0-9]/g, '');
    const senderDigits = (input.senderPn || '').replace(/[^0-9]/g, '');

    const whatsappJid = this.pickWhatsappJid([
      input.recipientJid,
      input.remoteJidAlt,
      input.remoteJid,
      input.replyToJid,
    ]);

    const primary: string[] = [];
    if (whatsappJid) {
      primary.push(whatsappJid);
    }
    if (phoneDigits.length >= 10) {
      primary.push(phoneDigits, `${phoneDigits}@s.whatsapp.net`);
    }
    if (senderDigits.length >= 10 && senderDigits !== phoneDigits) {
      primary.push(`${senderDigits}@s.whatsapp.net`, senderDigits);
    }

    const expanded: string[] = [];
    for (const target of primary) {
      expanded.push(...this.outboundNumberVariants(target));
    }

    if (expanded.length === 0) {
      for (const lid of [input.remoteJidAlt, input.remoteJid, input.replyToJid]) {
        if (lid?.endsWith('@lid')) {
          expanded.push(lid);
        }
      }
    }

    const unique = [...new Set(expanded.filter(Boolean))];
    return [
      ...unique.filter((target) => !target.includes('@lid')),
      ...unique.filter((target) => target.includes('@lid')),
    ];
  }

  private pickWhatsappJid(candidates: string[]): string | undefined {
    for (const jid of candidates) {
      if (jid?.includes('@s.whatsapp.net')) {
        return jid;
      }
    }
    return undefined;
  }

  /** Envia un mensaje de texto al estudiante. */
  async sendText(
    cfg: EvolutionConfig,
    to: string | string[],
    text: string,
    presenceDelayMs = 1200,
    options: { linkPreview?: boolean } = {},
  ): Promise<{ messageId?: string; numberUsed: string; keyUsed: string }> {
    await this.assertInstanceOpen(cfg);

    const targets = Array.isArray(to) ? to : this.outboundNumberVariants(to);
    let lastError: Error | undefined;

    for (const number of targets) {
      if (number.includes('@lid') && targets.some((t) => !t.includes('@lid'))) {
        continue;
      }

      try {
        await this.sendPresence(cfg, number, presenceDelayMs);
      } catch (err: any) {
        this.logger.debug(
          `sendPresence ${number} en ${cfg.instance}: ${err?.message || err}`,
        );
      }

      const body = {
        number,
        text,
        delay: presenceDelayMs,
        ...(options.linkPreview === false ? { linkPreview: false } : {}),
      };

      try {
        const { json, keySuffix } = await this.postWithKeyFallback(
          cfg,
          `/message/sendText/${cfg.instance}`,
          body,
          'sendText',
          true,
        );
        const messageId = json?.key?.id || json?.message?.key?.id;
        this.logger.log(
          `sendText OK instance=${cfg.instance} to=${number} msgId=${messageId || '?'} key=...${keySuffix}`,
        );
        this.logger.debug(
          `sendText respuesta ${cfg.instance}: ${JSON.stringify(json).slice(0, 400)}`,
        );
        return {
          messageId,
          numberUsed: number,
          keyUsed: keySuffix,
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `sendText destino ${number} fallo en ${cfg.instance}: ${lastError.message}`,
        );
      }
    }

    throw lastError || new Error(`sendText fallo para ${cfg.instance}`);
  }

  private async sendPresence(
    cfg: EvolutionConfig,
    to: string,
    delayMs: number,
  ): Promise<void> {
    await this.postWithKeyFallback(
      cfg,
      `/chat/sendPresence/${cfg.instance}`,
      { number: to, presence: 'composing', delay: delayMs },
      'sendPresence',
      true,
    );
  }

  async sendAudio(
    cfg: EvolutionConfig,
    to: string,
    audioBase64: string,
    _presenceDelayMs = 1200,
  ): Promise<void> {
    await this.assertInstanceOpen(cfg);
    const number = this.normalizeOutboundNumber(to);
    await this.postWithKeyFallback(
      cfg,
      `/message/sendWhatsAppAudio/${cfg.instance}`,
      { number, audio: audioBase64 },
      'sendAudio',
      true,
    );
  }

  async sendMedia(
    cfg: EvolutionConfig,
    to: string,
    media: string,
    options: {
      mediatype?: 'image' | 'video' | 'document';
      caption?: string;
      fileName?: string;
      mimetype?: string;
      delay?: number;
    } = {},
  ): Promise<void> {
    await this.assertInstanceOpen(cfg);
    const number = this.normalizeOutboundNumber(to);
    await this.postWithKeyFallback(
      cfg,
      `/message/sendMedia/${cfg.instance}`,
      {
        number,
        mediatype: options.mediatype || 'image',
        media,
        caption: options.caption,
        fileName: options.fileName,
        mimetype: options.mimetype,
        delay: options.delay,
      },
      'sendMedia',
      true,
    );
  }

  async sendVideo(
    cfg: EvolutionConfig,
    to: string,
    media: string,
    options: { caption?: string; fileName?: string; delay?: number } = {},
  ): Promise<void> {
    await this.sendMedia(cfg, to, media, {
      mediatype: 'video',
      caption: options.caption,
      fileName: options.fileName || 'video-modulo.mp4',
      mimetype: 'video/mp4',
      delay: options.delay ?? 2000,
    });
  }

  /** Lista conversaciones de la instancia (historial en Evolution, sin BD propia). */
  async findChats(cfg: EvolutionConfig): Promise<any[]> {
    const instance = this.instancePath(cfg.instance);
    const body = { limit: 200, offset: 0 };

    try {
      const { json } = await this.postWithKeyFallback(
        cfg,
        `/chat/findChats/${instance}`,
        body,
        'findChats',
        false,
      );
      return this.normalizeList(json);
    } catch (findErr: any) {
      this.logger.warn(
        `findChats/${cfg.instance}: ${findErr?.message || findErr}; probando alternativas`,
      );
      for (const attempt of [
        () =>
          this.postWithKeyFallback(
            cfg,
            `/chat/fetchChats/${instance}`,
            body,
            'fetchChatsPost',
            false,
          ),
        () => this.getWithKeyFallback(cfg, `/chat/fetchChats/${instance}`, 'fetchChatsGet', false),
      ]) {
        try {
          const { json } = await attempt();
          return this.normalizeList(json);
        } catch {
          // siguiente alternativa
        }
      }
      throw findErr;
    }
  }

  /** Mensajes de un chat concreto (paginado). */
  async findMessages(
    cfg: EvolutionConfig,
    remoteJid: string,
    page = 1,
    offset = 50,
  ): Promise<{ records: any[]; total?: number; pages?: number; currentPage?: number }> {
    const instance = this.instancePath(cfg.instance);
    const { json } = await this.postWithKeyFallback(
      cfg,
      `/chat/findMessages/${instance}`,
      {
        where: { key: { remoteJid } },
        page,
        offset,
      },
      'findMessages',
      false,
    );
    const messages = json?.messages ?? json;
    if (messages?.records) {
      return {
        records: messages.records,
        total: messages.total,
        pages: messages.pages,
        currentPage: messages.currentPage,
      };
    }
    return { records: this.normalizeList(json) };
  }

  private normalizeList(json: any): any[] {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.chats)) return json.chats;
    if (Array.isArray(json?.records)) return json.records;
    if (Array.isArray(json?.response)) return json.response;
    return json ? [json] : [];
  }

  async getBase64FromMediaMessage(cfg: EvolutionConfig, rawMessage: any): Promise<string | null> {
    try {
      const { json: res } = await this.postWithKeyFallback(
        cfg,
        `/chat/getBase64FromMediaMessage/${cfg.instance}`,
        { message: rawMessage, convertToMp4: false },
        'getBase64FromMediaMessage',
        false,
      );
      return res?.base64 || null;
    } catch (err: any) {
      this.logger.error(`Error descargando media de Evolution: ${err?.message || err}`);
      return null;
    }
  }

  private async assertInstanceOpen(cfg: EvolutionConfig): Promise<void> {
    const keys = this.allKeys(cfg);
    for (const key of keys) {
      try {
        const json = await this.get(this.withKey(cfg, key), `/instance/connectionState/${cfg.instance}`);
        const state = json?.instance?.state || json?.state || 'close';
        if (state === 'open') return;
        throw new Error(`state=${state}`);
      } catch (err: any) {
        this.logger.warn(
          `connectionState ${cfg.instance} con key ...${key.slice(-4)}: ${err?.message || err}`,
        );
      }
    }
    throw new Error(`Instancia Evolution "${cfg.instance}" no esta conectada (open)`);
  }

  private isMessageDelivered(json: any): boolean {
    return !!(json?.key?.id || json?.message?.key?.id);
  }

  private async postWithKeyFallback(
    cfg: EvolutionConfig,
    path: string,
    body: any,
    label: string,
    instanceKeysOnly: boolean,
  ): Promise<{ json: any; keySuffix: string }> {
    const keys = instanceKeysOnly ? this.instanceKeys(cfg) : this.allKeys(cfg);
    let lastError: Error | undefined;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const json = await this.post(this.withKey(cfg, key), path, body);
        if (path.includes('/message/send') && !this.isMessageDelivered(json)) {
          throw new Error(
            `Evolution no confirmo entrega (${label}): ${JSON.stringify(json).slice(0, 200)}`,
          );
        }
        if (i > 0) {
          this.logger.log(
            `${label} OK en ${cfg.instance} con apikey alternativa (intento ${i + 1})`,
          );
        }
        return { json, keySuffix: key.slice(-4) };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `${label} key ...${key.slice(-4)} fallo en ${cfg.instance}: ${lastError.message}`,
        );
      }
    }

    throw lastError || new Error(`${label} fallo sin apikeys validas`);
  }

  private async getWithKeyFallback(
    cfg: EvolutionConfig,
    path: string,
    label: string,
    instanceKeysOnly: boolean,
  ): Promise<any> {
    const keys = instanceKeysOnly ? this.instanceKeys(cfg) : this.allKeys(cfg);
    let lastError: Error | undefined;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const json = await this.get(this.withKey(cfg, key), path);
        if (i > 0) {
          this.logger.log(
            `${label} OK en ${cfg.instance} con apikey alternativa (intento ${i + 1})`,
          );
        }
        return json;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `${label} key ...${key.slice(-4)} fallo en ${cfg.instance}: ${lastError.message}`,
        );
      }
    }

    throw lastError || new Error(`${label} fallo sin apikeys validas`);
  }

  private async get(cfg: EvolutionConfig, path: string): Promise<any> {
    const url = `${this.base(cfg)}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(cfg.apiKey),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Evolution GET ${path} -> ${res.status} ${json?.message || ''}`);
    }
    return json;
  }

  private async post(cfg: EvolutionConfig, path: string, body: any): Promise<any> {
    const url = `${this.base(cfg)}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(cfg.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(
        `Evolution ${path} fallo status=${res.status} instance=${cfg.instance} to=${body?.number || '?'} msg=${json?.message || JSON.stringify(json).slice(0, 200)}`,
      );
      throw new Error(`Evolution API error ${res.status}: ${json?.message || ''}`);
    }
    if (json?.error || json?.status === 'error') {
      const msg = json?.message || JSON.stringify(json).slice(0, 200);
      throw new Error(`Evolution API error: ${msg}`);
    }
    const nestedError = json?.response?.message;
    if (Array.isArray(nestedError) && nestedError.some((m: any) => m?.exists === false)) {
      throw new Error(`Evolution API: destino no valido (${JSON.stringify(nestedError).slice(0, 300)})`);
    }
    return json;
  }
}
