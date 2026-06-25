import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { EvolutionAdminModule } from './evolution-admin.module';
import { AdminConversationsController } from '../controllers/admin-conversations.controller';
import { AdminLogsController } from '../controllers/admin-logs.controller';
import { ConversationHistoryService } from '../services/admin/conversation-history.service';
import { EvolutionService } from '../services/agent/evolution.service';

@Module({
  imports: [AuthModule, UsersModule, EvolutionAdminModule],
  controllers: [AdminConversationsController, AdminLogsController],
  providers: [ConversationHistoryService, EvolutionService],
})
export class AdminModule {}
