import { Module, forwardRef } from '@nestjs/common';
import { WorkflowController } from '../controllers/workflow.controller';
import { WorkflowService } from '../services/workflow.service';
import { AuthModule } from './auth.module';
import { N8nCredentialsModule } from './n8n-credentials.module';

@Module({
  imports: [AuthModule, forwardRef(() => N8nCredentialsModule)],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowsModule {}
