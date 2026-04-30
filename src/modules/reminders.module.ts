import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReminderController } from '../controllers/reminder.controller';
import { ReminderService } from '../services/reminder.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { ReminderSchedulerService } from '../services/reminder-scheduler.service';
import { InternalApiKeyGuard } from '../strategies/internal-api-key.guard';
import { StudentsModule } from './students.module';
import { CoursesModule } from './courses.module';
import { CourseModulesModule } from './course-modules.module';
import { ModuleProgressModule } from './module-progress.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    forwardRef(() => UsersModule),
    forwardRef(() => StudentsModule),
    forwardRef(() => CoursesModule),
    forwardRef(() => CourseModulesModule),
    forwardRef(() => ModuleProgressModule),
  ],
  controllers: [ReminderController],
  providers: [
    WhatsAppService,
    ReminderService,
    ReminderSchedulerService,
    InternalApiKeyGuard,
  ],
  exports: [ReminderService, WhatsAppService],
})
export class RemindersModule {}
