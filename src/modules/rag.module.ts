import { Module } from '@nestjs/common';
import { RagService } from '../services/agent/rag.service';

/** Módulo ligero para RAG/Pinecone sin arrastrar AgentModule (evita ciclos). */
@Module({
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
