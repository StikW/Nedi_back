import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe());
  
  // CORS: localhost + tututor.co y www.tututor.co (http/https)
  const localOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4200',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:8080',
  ]);

  const isTututorOrigin = (origin: string): boolean => {
    try {
      const { hostname } = new URL(origin);
      return hostname === 'tututor.co' || hostname === 'www.tututor.co';
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || localOrigins.has(origin) || isTututorOrigin(origin)) {
        callback(null, origin ?? true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cache-Control',
      'Pragma',
    ],
    credentials: true, // Permite cookies y headers de autenticación
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  
  const port = 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap(); 