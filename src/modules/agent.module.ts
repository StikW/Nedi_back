import { Module } from '@nestjs/common';
import { DatabaseModule } from '../core/database/database.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { CoursesModule } from './courses.module';
import { StudentsModule } from './students.module';
import { CourseModulesModule } from './course-modules.module';
import { ModuleProgressModule } from './module-progress.module';
import { UploadsModule } from './uploads.module';
import { RagModule } from './rag.module';

import { AgentWebhookController } from '../controllers/agent-webhook.controller';
import { AgentEvolutionController } from '../controllers/agent-evolution.controller';
import { VectorizationController } from '../controllers/vectorization.controller';

import { TenantService } from '../services/agent/tenant.service';
import { EvolutionService } from '../services/agent/evolution.service';
import { EvolutionAdminService } from '../services/agent/evolution-admin.service';
import { MediaService } from '../services/agent/media.service';
import { VectorizationService } from '../services/agent/vectorization.service';
import { AgentStateService } from '../services/agent/agent-state.service';
import { LlmService } from '../services/agent/llm.service';
import { MemoryService } from '../services/agent/memory.service';
import { QuestionsService } from '../services/agent/questions.service';
import { AgentsService } from '../services/agent/agents.service';
import { MessageBufferService } from '../services/agent/message-buffer.service';
import { AgentOrchestratorService } from '../services/agent/agent-orchestrator.service';

/**
 * Modulo del agente Nedi (microlearning por WhatsApp via Evolution).
 * Migracion 1:1 desde n8n a codigo, multi-instructor.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    StudentsModule,
    CourseModulesModule,
    ModuleProgressModule,
    UploadsModule,
    RagModule,
  ],
  controllers: [AgentWebhookController, AgentEvolutionController, VectorizationController],
  providers: [
    TenantService,
    EvolutionService,
    EvolutionAdminService,
    MediaService,
    VectorizationService,
    AgentStateService,
    LlmService,
    MemoryService,
    QuestionsService,
    AgentsService,
    MessageBufferService,
    AgentOrchestratorService,
  ],
  exports: [VectorizationService, AgentOrchestratorService, RagModule],
})
export class AgentModule {}
