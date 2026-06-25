import { Global, Module } from '@nestjs/common';
import { AgentActivityLogService } from './agent-activity-log.service';

@Global()
@Module({
  providers: [AgentActivityLogService],
  exports: [AgentActivityLogService],
})
export class LoggingModule {}
