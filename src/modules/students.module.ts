import { Module, forwardRef } from '@nestjs/common';
import { StudentController } from '../controllers/student.controller';
import { StudentService } from '../services/student.service';
import { DatabaseModule } from '../core/database/database.module';
import { CoursesModule } from './courses.module';
import { CourseModulesModule } from './course-modules.module';
import { ModuleProgressModule } from './module-progress.module';
import { AuthModule } from './auth.module';
import { RemindersModule } from './reminders.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    forwardRef(() => CoursesModule),
    forwardRef(() => CourseModulesModule),
    forwardRef(() => ModuleProgressModule),
    // Necesario para disparar la plantilla de bienvenida (`nedi_bienvenida_curso`)
    // autom\u00e1ticamente cuando se crea un estudiante.
    forwardRef(() => RemindersModule),
  ],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentsModule {}
