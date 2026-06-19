import { Module, forwardRef } from '@nestjs/common';
import { EvolutionAdminService } from '../services/agent/evolution-admin.service';
import { UsersModule } from './users.module';

@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [EvolutionAdminService],
  exports: [EvolutionAdminService],
})
export class EvolutionAdminModule {}
