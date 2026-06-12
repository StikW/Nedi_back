import { Module, forwardRef } from '@nestjs/common';
import { CourseModuleController } from '../controllers/course-module.controller';
import { CourseModuleService } from '../services/course-module.service';
import { CoursesModule } from './courses.module';
import { AuthModule } from './auth.module';
import { DatabaseModule } from '../core/database/database.module';
import { UploadsModule } from './uploads.module';
import { RagModule } from './rag.module';
import { ModuleProgressModule } from './module-progress.module';

@Module({
  imports: [
    forwardRef(() => CoursesModule),
    RagModule,
    ModuleProgressModule,
    AuthModule,
    DatabaseModule,
    UploadsModule,
  ],
  controllers: [CourseModuleController],
  providers: [CourseModuleService],
  exports: [CourseModuleService],
})
export class CourseModulesModule {}
