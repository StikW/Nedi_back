import { Module } from '@nestjs/common';
import { ModuleProgressController } from '../controllers/module-progress.controller';
import { ModuleProgressService } from '../services/module-progress.service';
import { StudentProgressCleanupService } from '../services/student-progress-cleanup.service';
import { DatabaseModule } from '../core/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ModuleProgressController],
  providers: [ModuleProgressService, StudentProgressCleanupService],
  exports: [ModuleProgressService, StudentProgressCleanupService],
})
export class ModuleProgressModule {}
