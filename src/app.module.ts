import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './modules/health.module';
import { DatabaseModule } from './core/database/database.module';
import { UsersModule } from './modules/users.module';
import { CoursesModule } from './modules/courses.module';
import { CourseModulesModule } from './modules/course-modules.module';
import { AuthModule } from './modules/auth.module';
import { UploadsModule } from './modules/uploads.module';
import { WorkflowsModule } from './modules/workflows.module';
import { StudentsModule } from './modules/students.module';
import { ModuleProgressModule } from './modules/module-progress.module';
import { N8nCredentialsModule } from './modules/n8n-credentials.module';
import { TemplateModule } from './modules/template.module';
import { PublicConfigModule } from './modules/public-config.module';
import { RemindersModule } from './modules/reminders.module';
import { AgentModule } from './modules/agent.module';
import envConfig from './core/config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
      load: [envConfig],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    TemplateModule,
    HealthModule,
    UsersModule,
    CoursesModule,
    CourseModulesModule,
    AuthModule,
    UploadsModule,
    PublicConfigModule,
    WorkflowsModule,
    StudentsModule,
    ModuleProgressModule,
    N8nCredentialsModule,
    RemindersModule,
    AgentModule,
  ],
})
export class AppModule {} 