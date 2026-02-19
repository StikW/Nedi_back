import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe());
  
  // Configuración de CORS más específica
  app.enableCors({
    origin: [
      'http://localhost:3000',    // Frontend local
      'http://localhost:3001',    // Frontend alternativo
      'http://localhost:4200',    // Angular por defecto
      'http://localhost:8080',    // Vue.js por defecto
      'http://127.0.0.1:3000',    // IP local
      'http://127.0.0.1:3001',
      'http://127.0.0.1:4200',
      'http://127.0.0.1:8080',
      // Agrega aquí tu dominio de producción cuando lo tengas
      // 'https://tu-dominio.com',
    ],
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