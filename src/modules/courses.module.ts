import { Module, forwardRef } from '@nestjs/common';
import { CourseController } from '../controllers/course.controller';
import { PublicCourseController } from '../controllers/public-course.controller';
import { CourseService } from '../services/course.service';
import { AuthModule } from './auth.module';
import { StudentsModule } from './students.module';
import { CourseModulesModule } from './course-modules.module';

@Module({
  imports: [
    AuthModule, 
    forwardRef(() => StudentsModule),
    forwardRef(() => CourseModulesModule)
  ],
  controllers: [CourseController, PublicCourseController],
  providers: [CourseService],
  exports: [CourseService],
})
export class CoursesModule {} 