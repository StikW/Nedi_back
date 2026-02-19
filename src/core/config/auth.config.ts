import { JwtModuleOptions } from '@nestjs/jwt';

export const jwtConfig: JwtModuleOptions = {
  secret: process.env.JWT_SECRET || 'your-secret-key',
  signOptions: { expiresIn: '7d' },
};

export const passportConfig = {
  defaultStrategy: 'jwt',
} as const; 