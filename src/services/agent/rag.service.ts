import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

/**
 * Recuperacion aumentada (RAG) sobre el contenido de los modulos.
 *
 * Un solo indice Pinecone (`courses`), `namespace = courseId` y metadata
 * `module = moduleId`. Reemplaza los nodos `vector_questions`,
 * `vector_validation` y `vector_explain`, todos sobre el mismo indice.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly pinecone: Pinecone | null;
  private readonly openai: OpenAI;
  private readonly indexName: string;
  private readonly embeddingModel: string;
  private readonly embeddingDimensions: number;

  constructor(private readonly configService: ConfigService) {
    const pineconeKey = this.configService.get<string>('PINECONE_API_KEY');
    this.pinecone = pineconeKey ? new Pinecone({ apiKey: pineconeKey }) : null;
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'not-configured',
    });
    this.indexName = this.configService.get<string>('PINECONE_INDEX') || 'courses';
    this.embeddingModel =
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';
    const dims = this.configService.get<number | string>('OPENAI_EMBEDDING_DIMENSIONS');
    this.embeddingDimensions = dims != null && dims !== '' ? Number(dims) : 512;
  }

  /** Genera el embedding de un texto (512 dims, igual que n8n / indice Pinecone). */
  async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
      dimensions: this.embeddingDimensions,
    });
    return res.data[0].embedding as number[];
  }

  /**
   * Recupera fragmentos relevantes del modulo y los concatena como contexto.
   * @returns texto de contexto (vacio si no hay Pinecone o sin resultados)
   */
  /** Descarta fragmentos basura del indice legacy de n8n (ej. "es_419", "1.4"). */
  private isUsefulChunk(text: string): boolean {
    const t = text.trim();
    if (t.length < 40) return false;
    if (/^es_[a-z0-9]{2,6}$/i.test(t)) return false;
    if (/^[\d.]+$/.test(t)) return false;
    return true;
  }

  async retrieveContext(
    courseId: string,
    moduleId: string | undefined,
    query: string,
    topK = 4,
  ): Promise<string> {
    if (!this.pinecone) {
      this.logger.warn('Pinecone no configurado: se omite RAG');
      return '';
    }
    try {
      const vector = await this.embed(query);
      const ns = this.pinecone.index(this.indexName).namespace(courseId);
      const result = await ns.query({
        // Consultamos mas resultados y filtramos ruido; luego nos quedamos con topK utiles
        topK: Math.max(topK * 3, 12),
        vector,
        includeMetadata: true,
        ...(moduleId ? { filter: { module: { $eq: moduleId } } } : {}),
      });
      const chunks = (result.matches || [])
        .map((m) => (m.metadata?.text || m.metadata?.pageContent || '') as string)
        .filter((t) => this.isUsefulChunk(t))
        .slice(0, topK);
      return chunks.join('\n---\n');
    } catch (err: any) {
      this.logger.error(`Error consultando Pinecone: ${err?.message || err}`);
      return '';
    }
  }

  /** Inserta fragmentos vectorizados de un modulo (usado por VectorizationService). */
  async upsertChunks(
    courseId: string,
    moduleId: string,
    chunks: string[],
  ): Promise<number> {
    if (!this.pinecone) {
      this.logger.warn('Pinecone no configurado: no se vectoriza');
      return 0;
    }
    const ns = this.pinecone.index(this.indexName).namespace(courseId);
    const vectors = [];
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      if (!text || !text.trim()) continue;
      const values = await this.embed(text);
      vectors.push({
        id: `${moduleId}-${i}`,
        values,
        metadata: { module: moduleId, courseId, text },
      });
    }
    if (vectors.length === 0) return 0;
    // Pinecone limita el tamano del batch; subimos en lotes de 100
    for (let i = 0; i < vectors.length; i += 100) {
      await ns.upsert({ records: vectors.slice(i, i + 100) } as any);
    }
    return vectors.length;
  }

  /** Elimina todos los vectores del curso (namespace = courseId). */
  async deleteCourseNamespace(courseId: string): Promise<void> {
    if (!this.pinecone) {
      this.logger.warn('Pinecone no configurado: no se eliminan vectores del curso');
      return;
    }
    try {
      await this.pinecone.index(this.indexName).namespace(courseId).deleteAll();
      this.logger.log(`Namespace Pinecone eliminado: ${courseId}`);
    } catch (err: any) {
      this.logger.error(`Error eliminando namespace Pinecone ${courseId}: ${err?.message || err}`);
      throw err;
    }
  }

  /** Elimina vectores de un módulo concreto dentro del namespace del curso. */
  async deleteModuleVectors(courseId: string, moduleId: string): Promise<void> {
    if (!this.pinecone) {
      this.logger.warn('Pinecone no configurado: no se eliminan vectores del módulo');
      return;
    }
    try {
      await this.pinecone
        .index(this.indexName)
        .namespace(courseId)
        .deleteMany({ filter: { module: { $eq: moduleId } } });
      this.logger.log(`Vectores Pinecone eliminados: curso ${courseId}, módulo ${moduleId}`);
    } catch (err: any) {
      this.logger.error(
        `Error eliminando vectores del módulo ${moduleId}: ${err?.message || err}`,
      );
      throw err;
    }
  }

  /** Cuenta registros en el namespace del curso (útil para E2E). */
  async countCourseVectors(courseId: string): Promise<number> {
    if (!this.pinecone) {
      return 0;
    }
    try {
      const stats = await this.pinecone.index(this.indexName).describeIndexStats();
      const ns = stats.namespaces?.[courseId];
      return ns?.recordCount ?? 0;
    } catch (err: any) {
      this.logger.error(`Error contando vectores de ${courseId}: ${err?.message || err}`);
      return 0;
    }
  }
}
