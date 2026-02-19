import { Module, forwardRef } from '@nestjs/common';
import { CourseModuleController } from '../controllers/course-module.controller';
import { CourseModuleService } from '../services/course-module.service';
import { ModuleProgressService } from '../services/module-progress.service';
import { CoursesModule } from './courses.module';
import { AuthModule } from './auth.module';
import { DatabaseModule } from '../core/database/database.module';
import { UploadsModule } from './uploads.module';

@Module({
  imports: [forwardRef(() => CoursesModule), AuthModule, DatabaseModule, UploadsModule],
  controllers: [CourseModuleController],
  providers: [CourseModuleService, ModuleProgressService],
  exports: [CourseModuleService],
})
export class CourseModulesModule {}
