import { Injectable, Logger } from '@nestjs/common';
import { CourseModuleService } from '../course-module.service';
import { UploadsService } from '../uploads.service';
import { RagService } from './rag.service';
// pdf-parse no expone tipos ESM; require directo evita el bloque de "debug" del paquete
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

export interface VectorizationResult {
  success: boolean;
  files: number;
  chunks: number;
  message: string;
}

/**
 * Ingesta del contenido del modulo en Pinecone. Migra el flujo n8n
 * `WF_Vectorizacion` (webhook /vectorizacion):
 *   S3 (bucket de modulos) -> extraer PDF/TXT -> split recursivo (2000/200)
 *   -> embeddings OpenAI -> upsert en index `courses`, namespace=courseId,
 *   metadata module=moduleId.
 */
@Injectable()
export class VectorizationService {
  private readonly logger = new Logger(VectorizationService.name);
  private static readonly CHUNK_SIZE = 2000;
  private static readonly CHUNK_OVERLAP = 200;

  constructor(
    private readonly courseModuleService: CourseModuleService,
    private readonly uploadsService: UploadsService,
    private readonly rag: RagService,
  ) {}

  /**
   * Vectoriza todos los archivos (PDF/TXT) subidos al modulo. Si no hay
   * archivos, cae al texto del modulo (titulo/descripcion/contenido).
   */
  async ingestModule(courseId: string, moduleId: string): Promise<VectorizationResult> {
    const keys = await this.uploadsService.listModuleFileKeys(courseId, moduleId);

    const texts: string[] = [];
    let processedFiles = 0;

    for (const key of keys) {
      const ext = this.extension(key);
      if (!['pdf', 'txt', 'md', 'text'].includes(ext)) {
        this.logger.warn(`Saltando archivo no soportado para vectorizar: ${key}`);
        continue;
      }
      try {
        const buffer = await this.uploadsService.getModuleFileBuffer(key);
        const text = ext === 'pdf' ? await this.extractPdf(buffer) : buffer.toString('utf-8');
        if (text && text.trim()) {
          texts.push(text);
          processedFiles++;
        }
      } catch (err: any) {
        this.logger.error(`Error extrayendo ${key}: ${err?.message || err}`);
      }
    }

    // Fallback: si no hubo archivos utiles, usar el texto del modulo
    if (texts.length === 0) {
      const module = await this.courseModuleService.findOne(moduleId);
      const fallback = [module?.title, module?.description, module?.content].filter(Boolean).join('\n\n');
      if (!fallback.trim()) {
        return { success: false, files: 0, chunks: 0, message: 'No hay contenido para vectorizar' };
      }
      texts.push(fallback);
    }

    const fullText = texts.join('\n\n');
    const chunks = this.splitRecursive(fullText, VectorizationService.CHUNK_SIZE, VectorizationService.CHUNK_OVERLAP);
    const count = await this.rag.upsertChunks(courseId, moduleId, chunks);

    this.logger.log(`Vectorizados ${count} fragmentos (${processedFiles} archivos) del modulo ${moduleId}`);
    return {
      success: count > 0,
      files: processedFiles,
      chunks: count,
      message: count > 0 ? 'Vectorizacion completada' : 'No se generaron vectores',
    };
  }

  private extension(key: string): string {
    const m = key.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
    return m ? m[1] : '';
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const data = await pdfParse(buffer);
    return data?.text || '';
  }

  /**
   * Splitter recursivo por separadores (parrafos -> lineas -> oraciones ->
   * palabras), con solape. Aproxima al RecursiveCharacterTextSplitter de n8n.
   */
  private splitRecursive(text: string, size: number, overlap: number): string[] {
    const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (clean.length <= size) return clean ? [clean] : [];

    const separators = ['\n\n', '\n', '. ', ' '];
    const pieces = this.recursiveSplit(clean, separators, size);

    // Reagrupar piezas en chunks <= size con solape entre chunks
    const chunks: string[] = [];
    let current = '';
    for (const piece of pieces) {
      if ((current + piece).length > size && current) {
        chunks.push(current.trim());
        const tail = current.slice(Math.max(0, current.length - overlap));
        current = tail + piece;
      } else {
        current += piece;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter((c) => c.trim().length > 0);
  }

  private recursiveSplit(text: string, separators: string[], size: number): string[] {
    if (text.length <= size || separators.length === 0) return [text];
    const [sep, ...rest] = separators;
    const parts = text.split(sep).map((p, i, arr) => (i < arr.length - 1 ? p + sep : p));
    const result: string[] = [];
    for (const part of parts) {
      if (part.length <= size) result.push(part);
      else result.push(...this.recursiveSplit(part, rest, size));
    }
    return result;
  }
}
