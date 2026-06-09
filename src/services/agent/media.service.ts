import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

/**
 * Procesamiento multimedia con OpenAI: transcripcion de audio, analisis de
 * imagen y sintesis de voz (TTS). Equivale a los nodos `Transcribe a recording`,
 * `Analyze image` y `HTTP Request (/v1/audio/speech)` de n8n.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    // Fallback no vacio para que el arranque de la app no falle si el agente
    // aun no esta configurado; las llamadas reales fallaran si falta la key.
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'not-configured',
    });
  }

  /** Transcribe un audio (base64) a texto. */
  async transcribeAudio(audioBase64: string, mime = 'audio/ogg'): Promise<string> {
    try {
      const buffer = Buffer.from(audioBase64, 'base64');
      const ext = mime.includes('mp3') ? 'mp3' : mime.includes('wav') ? 'wav' : 'ogg';
      const file = await toFile(buffer, `audio.${ext}`, { type: mime });
      const model = this.configService.get<string>('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-transcribe';
      const res = await this.client.audio.transcriptions.create({ file, model });
      return (res as any).text || '';
    } catch (err: any) {
      this.logger.error(`Error transcribiendo audio: ${err?.message || err}`);
      return '';
    }
  }

  /** Describe/analiza una imagen (base64) y devuelve texto. */
  async analyzeImage(imageBase64: string, mime = 'image/jpeg', prompt?: string): Promise<string> {
    try {
      const model = this.configService.get<string>('OPENAI_VISION_MODEL') || 'gpt-4o-mini';
      const dataUrl = `data:${mime};base64,${imageBase64}`;
      const res = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  prompt ||
                  'Describe el contenido de esta imagen de forma breve y util para responder al estudiante.',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ] as any,
          },
        ],
      });
      return res.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      this.logger.error(`Error analizando imagen: ${err?.message || err}`);
      return '';
    }
  }

  /** Sintetiza voz a partir de texto. Devuelve base64 del audio (mp3). */
  async textToSpeechBase64(text: string): Promise<string | null> {
    try {
      const model = this.configService.get<string>('OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts';
      const voice = this.configService.get<string>('OPENAI_TTS_VOICE') || 'alloy';
      const res = await this.client.audio.speech.create({
        model,
        voice: voice as any,
        input: text,
      });
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    } catch (err: any) {
      this.logger.error(`Error generando TTS: ${err?.message || err}`);
      return null;
    }
  }
}
