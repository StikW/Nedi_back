import { Module, forwardRef } from '@nestjs/common';
import { ModuleProgressController } from '../controllers/module-progress.controller';
import { ModuleProgressService } from '../services/module-progress.service';
import { DatabaseModule } from '../core/database/database.module';
import { GamificationModule } from './gamification.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => GamificationModule)],
  controllers: [ModuleProgressController],
  providers: [ModuleProgressService],
  exports: [ModuleProgressService],
})
export class ModuleProgressModule {}
