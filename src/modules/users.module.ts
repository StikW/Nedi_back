import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from '../controllers/auth.controller';
import { UsersController } from '../controllers/users.controller';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import { AuthModule } from './auth.module';
import { CoursesModule } from './courses.module';
import { ModuleProgressModule } from './module-progress.module';
import { EvolutionAdminModule } from './evolution-admin.module';

/**
 * Module responsible for user management and authentication
 */
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => CoursesModule),
    ModuleProgressModule,
    forwardRef(() => EvolutionAdminModule),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
