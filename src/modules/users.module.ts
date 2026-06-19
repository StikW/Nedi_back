import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from '../controllers/auth.controller';
import { UsersController } from '../controllers/users.controller';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import { AuthModule } from './auth.module';

/**
 * Module responsible for user management and authentication
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
