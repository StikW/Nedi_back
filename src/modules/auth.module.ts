import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { passportConfig } from '../core/config/auth.config';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { UsersModule } from './users.module';
import { TokenBlacklistService } from '../services/token-blacklist.service';

@Module({
  imports: [
    PassportModule.register(passportConfig),
    // registerAsync: el secreto se lee tras cargar .env; register() leía env antes de ConfigModule y rompía la firma vs JwtStrategy
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
    }),
    forwardRef(() => UsersModule),
  ],
  providers: [JwtStrategy, TokenBlacklistService],
  exports: [PassportModule, JwtModule, TokenBlacklistService],
})
export class AuthModule {} 