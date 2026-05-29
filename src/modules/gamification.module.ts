import { Module, forwardRef } from '@nestjs/common';
import { GamificationController } from '../controllers/gamification.controller';
import { GamificationService } from '../services/gamification.service';
import { DatabaseModule } from '../core/database/database.module';
import { ModuleProgressModule } from './module-progress.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => ModuleProgressModule)],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
