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

  private headers(cfg: EvolutionConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: cfg.apiKey,
    };
  }

  private base(cfg: EvolutionConfig): string {
    return (cfg.serverUrl || '').replace(/\/+$/, '');
  }

  /** Presencia justo antes de enviar: `composing` (texto) o `recording` (audio). */
  async sendPresence(
    cfg: EvolutionConfig,
    to: string,
    presence: 'composing' | 'recording',
    delayMs = 1200,
  ): Promise<void> {
    try {
      await this.post(cfg, `/chat/sendPresence/${cfg.instance}`, {
        number: to,
        presence,
        delay: delayMs,
      });
    } catch (err: any) {
      this.logger.debug(`sendPresence(${presence}) omitido: ${err?.message || err}`);
    }
  }

  /** Envia un mensaje de texto al estudiante. */
  async sendText(
    cfg: EvolutionConfig,
    to: string,
    text: string,
    presenceDelayMs = 1200,
    options: { linkPreview?: boolean } = {},
  ): Promise<void> {
    await this.sendPresence(cfg, to, 'composing', presenceDelayMs);
    await this.post(cfg, `/message/sendText/${cfg.instance}`, {
      number: to,
      text,
      ...(options.linkPreview === false ? { linkPreview: false } : {}),
    });
  }

  /** Envia una nota de voz (audio en base64). */
  async sendAudio(
    cfg: EvolutionConfig,
    to: string,
    audioBase64: string,
    presenceDelayMs = 1200,
  ): Promise<void> {
    await this.sendPresence(cfg, to, 'recording', presenceDelayMs);
    await this.post(cfg, `/message/sendWhatsAppAudio/${cfg.instance}`, {
      number: to,
      audio: audioBase64,
    });
  }

  /** Envia media (imagen/documento/video) por URL o base64. */
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
    await this.post(cfg, `/message/sendMedia/${cfg.instance}`, {
      number: to,
      mediatype: options.mediatype || 'image',
      media,
      caption: options.caption,
      fileName: options.fileName,
      mimetype: options.mimetype,
      delay: options.delay,
    });
  }

  /** Envia un video del modulo (equivalente al sub-workflow sendVideo). */
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

  /**
   * Descarga el contenido base64 de un mensaje de media (audio/imagen) recibido.
   * Equivale a `get_audio` / `get_image` (getBase64FromMediaMessage).
   */
  async getBase64FromMediaMessage(cfg: EvolutionConfig, rawMessage: any): Promise<string | null> {
    try {
      const res = await this.post(cfg, `/chat/getBase64FromMediaMessage/${cfg.instance}`, {
        message: rawMessage,
        convertToMp4: false,
      });
      return res?.base64 || null;
    } catch (err: any) {
      this.logger.error(`Error descargando media de Evolution: ${err?.message || err}`);
      return null;
    }
  }

  private async post(cfg: EvolutionConfig, path: string, body: any): Promise<any> {
    const url = `${this.base(cfg)}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(cfg),
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(
        `Evolution ${path} fallo status=${res.status} instance=${cfg.instance} msg=${json?.message || JSON.stringify(json).slice(0, 200)}`,
      );
      throw new Error(`Evolution API error ${res.status}`);
    }
    if (json?.error || json?.status === 'error') {
      const msg = json?.message || JSON.stringify(json).slice(0, 200);
      this.logger.error(`Evolution ${path} respondio error instance=${cfg.instance}: ${msg}`);
      throw new Error(`Evolution API error: ${msg}`);
    }
    return json;
  }
}
