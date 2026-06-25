import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { ConversationHistoryService } from '../services/admin/conversation-history.service';

/** Historial de conversaciones del agente (Evolution API, sin BD). */
@Controller('admin/agent/conversations')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminConversationsController {
  constructor(private readonly conversations: ConversationHistoryService) {}

  @Get('instructors')
  listInstructors() {
    return this.conversations.listInstructors();
  }

  @Get(':instructorId/chats')
  listChats(@Param('instructorId') instructorId: string) {
    return this.conversations.listChats(instructorId);
  }

  @Get(':instructorId/messages')
  listMessages(
    @Param('instructorId') instructorId: string,
    @Query('remoteJid') remoteJid: string,
    @Query('page') page?: string,
    @Query('offset') offset?: string,
  ) {
    return this.conversations.listMessages(
      instructorId,
      remoteJid,
      page ? Number(page) : 1,
      offset ? Number(offset) : 50,
    );
  }
}
