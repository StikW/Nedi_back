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

  constructor(private readonly configService: ConfigService) {
    const pineconeKey = this.configService.get<string>('PINECONE_API_KEY');
    this.pinecone = pineconeKey ? new Pinecone({ apiKey: pineconeKey }) : null;
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'not-configured',
    });
    this.indexName = this.configService.get<string>('PINECONE_INDEX') || 'courses';
    this.embeddingModel =
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';
  }

  /** Genera el embedding de un texto. */
  async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({ model: this.embeddingModel, input: text });
    return res.data[0].embedding as number[];
  }

  /**
   * Recupera fragmentos relevantes del modulo y los concatena como contexto.
   * @returns texto de contexto (vacio si no hay Pinecone o sin resultados)
   */
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
        topK,
        vector,
        includeMetadata: true,
        ...(moduleId ? { filter: { module: { $eq: moduleId } } } : {}),
      });
      const chunks = (result.matches || [])
        .map((m) => (m.metadata?.text || m.metadata?.pageContent || '') as string)
        .filter((t) => t && t.trim().length > 0);
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
}
