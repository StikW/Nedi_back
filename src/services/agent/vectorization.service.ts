import { Injectable, Logger } from '@nestjs/common';
import { CourseModuleService } from '../course-module.service';
import { UploadsService } from '../uploads.service';
import { RagService } from './rag.service';
import { ModuleResource } from '../../models/course-module.entity';
// pdf-parse v2 exporta la clase PDFParse (ya no es una funcion directa)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require('pdf-parse');

export interface VectorizationResult {
  success: boolean;
  files: number;
  chunks: number;
  message: string;
}

export interface ModuleDocumentText {
  text: string;
  files: number;
  source: 's3' | 'fallback' | 'none';
  /** PDFs encontrados en S3 pero no legibles (parseo fallido). */
  extractFailed?: boolean;
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
  /** Limite prudente para el prompt del generador de preguntas. */
  static readonly MAX_MATERIAL_CHARS = 120_000;

  constructor(
    private readonly courseModuleService: CourseModuleService,
    private readonly uploadsService: UploadsService,
    private readonly rag: RagService,
  ) {}

  /**
   * Extrae el texto educativo del modulo desde los PDF/TXT en S3.
   * Equivale al flujo de WF_GeneradorPreguntas (agregar todo el PDF, no RAG parcial).
   */
  async extractModuleDocumentText(courseId: string, moduleId: string): Promise<ModuleDocumentText> {
    const module = await this.courseModuleService.findOne(moduleId);
    const keys = [
      ...(await this.uploadsService.listModuleFileKeys(courseId, moduleId)),
      ...this.keysFromModuleResources(module?.resources),
    ];
    const uniqueKeys = [...new Set(keys)];

    const texts: string[] = [];
    let processedFiles = 0;
    let extractAttempts = 0;

    for (const key of uniqueKeys) {
      const ext = this.extension(key);
      if (!['pdf', 'txt', 'md', 'text'].includes(ext)) {
        this.logger.warn(`Saltando archivo no soportado para extraer texto: ${key}`);
        continue;
      }
      extractAttempts++;
      try {
        const buffer = await this.uploadsService.getModuleFileBuffer(key);
        const raw = ext === 'pdf' ? await this.extractPdf(buffer) : buffer.toString('utf-8');
        const text = this.sanitizeEducationalText(raw);
        if (text) {
          texts.push(text);
          processedFiles++;
        }
      } catch (err: any) {
        this.logger.error(`Error extrayendo ${key}: ${err?.message || err}`);
      }
    }

    if (texts.length > 0) {
      return {
        text: this.truncateMaterial(texts.join('\n\n')),
        files: processedFiles,
        source: 's3',
      };
    }

    if (extractAttempts > 0) {
      this.logger.error(
        `Modulo ${moduleId}: ${extractAttempts} archivo(s) en S3 pero no se pudo extraer texto`,
      );
      return { text: '', files: 0, source: 'none', extractFailed: true };
    }

    const fallback = this.sanitizeEducationalText(
      [module?.title, module?.description].filter(Boolean).join('\n\n'),
    );
    if (!fallback) {
      return { text: '', files: 0, source: 'none' };
    }

    this.logger.warn(
      `Modulo ${moduleId} sin PDF/TXT en S3; se usa titulo/descripcion como fallback (sin URL de video).`,
    );
    return { text: fallback, files: 0, source: 'fallback' };
  }

  /** Obtiene keys S3 a partir de las URLs guardadas en module.resources. */
  keysFromModuleResources(resources?: ModuleResource[]): string[] {
    if (!resources?.length) return [];
    return resources
      .map((resource) => this.uploadsService.s3KeyFromResourceUrl(resource.url))
      .filter((key): key is string => !!key);
  }

  /**
   * Vectoriza todos los archivos (PDF/TXT) subidos al modulo. Si no hay
   * archivos, cae al titulo y descripcion (nunca la URL del video en content).
   */
  async ingestModule(courseId: string, moduleId: string): Promise<VectorizationResult> {
    const { text, files, source } = await this.extractModuleDocumentText(courseId, moduleId);
    if (!text) {
      return { success: false, files: 0, chunks: 0, message: 'No hay contenido para vectorizar' };
    }

    if (source === 'fallback') {
      this.logger.warn(
        `Vectorizando modulo ${moduleId} solo con metadatos; sube un PDF para mejores preguntas.`,
      );
    }

    await this.rag.deleteModuleVectors(courseId, moduleId);

    const chunks = this.splitRecursive(text, VectorizationService.CHUNK_SIZE, VectorizationService.CHUNK_OVERLAP);
    const count = await this.rag.upsertChunks(courseId, moduleId, chunks);

    this.logger.log(`Vectorizados ${count} fragmentos (${files} archivos) del modulo ${moduleId}`);
    return {
      success: count > 0,
      files,
      chunks: count,
      message: count > 0 ? 'Vectorizacion completada' : 'No se generaron vectores',
    };
  }

  /** Quita URLs y ruido de formato antes de vectorizar o generar preguntas. */
  sanitizeEducationalText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/https?:\/\/[^\s)\]>]+/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  truncateMaterial(text: string): string {
    if (text.length <= VectorizationService.MAX_MATERIAL_CHARS) return text;
    this.logger.warn(
      `Material del modulo truncado de ${text.length} a ${VectorizationService.MAX_MATERIAL_CHARS} caracteres`,
    );
    return text.slice(0, VectorizationService.MAX_MATERIAL_CHARS);
  }

  private extension(key: string): string {
    const m = key.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
    return m ? m[1] : '';
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text || '';
    } finally {
      await parser.destroy();
    }
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
