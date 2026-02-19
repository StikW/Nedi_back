import { Module, forwardRef } from '@nestjs/common';
import { N8nCredentialController } from '../controllers/n8n-credential.controller';
import { N8nCredentialService } from '../services/n8n-credential.service';
import { WorkflowsModule } from './workflows.module';

@Module({
  imports: [forwardRef(() => WorkflowsModule)],
  controllers: [N8nCredentialController],
  providers: [N8nCredentialService],
  exports: [N8nCredentialService],
})
export class N8nCredentialsModule {}
