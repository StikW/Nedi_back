import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { jwtConfig, passportConfig } from '../core/config/auth.config';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { UsersModule } from './users.module';
import { TokenBlacklistService } from '../services/token-blacklist.service';

@Module({
  imports: [
    PassportModule.register(passportConfig),
    JwtModule.register(jwtConfig),
    forwardRef(() => UsersModule),
  ],
  providers: [JwtStrategy, TokenBlacklistService],
  exports: [PassportModule, JwtModule, TokenBlacklistService],
})
export class AuthModule {} 