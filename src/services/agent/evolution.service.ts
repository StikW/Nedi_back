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

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: apiKey,
    };
  }

  private base(cfg: EvolutionConfig): string {
    return (cfg.serverUrl || '').replace(/\/+$/, '');
  }

  private withKey(cfg: EvolutionConfig, apiKey: string): EvolutionConfig {
    return { ...cfg, apiKey };
  }

  /** Claves de la instancia (webhook/guardada). Admin solo como ultimo recurso. */
  private instanceKeys(cfg: EvolutionConfig): string[] {
    const keys = cfg.apiKeys?.length ? cfg.apiKeys : [cfg.apiKey];
    if (keys.length <= 1) return keys.filter(Boolean);
    const last = keys[keys.length - 1];
    const instanceOnly = keys.slice(0, -1).filter(Boolean);
    return instanceOnly.length > 0 ? instanceOnly : keys.filter(Boolean);
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

  /** n8n enviaba el JID completo; v2 acepta digitos. Probamos ambos. */
  private outboundNumberVariants(to: string): string[] {
    const digits = this.normalizeOutboundNumber(to);
    return [...new Set([digits, `${digits}@s.whatsapp.net`])];
  }

  /** Envia un mensaje de texto al estudiante. */
  async sendText(
    cfg: EvolutionConfig,
    to: string,
    text: string,
    presenceDelayMs = 1200,
    options: { linkPreview?: boolean } = {},
  ): Promise<{ messageId?: string; numberUsed: string; keyUsed: string }> {
    await this.assertInstanceOpen(cfg);

    const variants = this.outboundNumberVariants(to);
    let lastError: Error | undefined;

    for (const number of variants) {
      const body = {
        number,
        text,
        delay: presenceDelayMs,
        ...(options.linkPreview === false ? { linkPreview: false } : {}),
      };

      try {
        const json = await this.postWithKeyFallback(
          cfg,
          `/message/sendText/${cfg.instance}`,
          body,
          'sendText',
          true,
        );
        const messageId = json?.key?.id || json?.message?.key?.id;
        this.logger.log(
          `sendText OK instance=${cfg.instance} to=${number} msgId=${messageId || '?'}`,
        );
        return { messageId, numberUsed: number, keyUsed: 'instance' };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `sendText formato ${number} fallo en ${cfg.instance}: ${lastError.message}`,
        );
      }
    }

    throw lastError || new Error(`sendText fallo para ${cfg.instance}`);
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

  async getBase64FromMediaMessage(cfg: EvolutionConfig, rawMessage: any): Promise<string | null> {
    try {
      const res = await this.postWithKeyFallback(
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
    instanceKeysOnlyFirst: boolean,
  ): Promise<any> {
    const keySets = instanceKeysOnlyFirst
      ? [this.instanceKeys(cfg), this.allKeys(cfg)]
      : [this.allKeys(cfg)];

    let lastError: Error | undefined;

    for (const keys of keySets) {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        try {
          const json = await this.post(this.withKey(cfg, key), path, body);
          if (path.includes('/message/send') && !this.isMessageDelivered(json)) {
            throw new Error(
              `Evolution no confirmo entrega (${label}): ${JSON.stringify(json).slice(0, 200)}`,
            );
          }
          if (i > 0 || keys !== keySets[0]) {
            const isAdminFallback = key === cfg.apiKeys?.[cfg.apiKeys.length - 1];
            this.logger.log(
              `${label} OK en ${cfg.instance} con apikey alternativa (set ${keySets.indexOf(keys) + 1}, intento ${i + 1}${isAdminFallback ? ', admin fallback' : ''})`,
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
    }

    throw lastError || new Error(`${label} fallo sin apikeys validas`);
  }

  private async get(cfg: EvolutionConfig, path: string): Promise<any> {
    const url = `${this.base(cfg)}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(cfg.apiKey),
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
