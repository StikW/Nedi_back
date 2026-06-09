import { Body, Controller, ForbiddenException, Post, Request, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { User } from '../models/user.entity';
import { CourseService } from '../services/course.service';
import { VectorizationService } from '../services/agent/vectorization.service';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * Dispara la vectorizacion del contenido de un modulo (migrado del webhook n8n
 * /vectorizacion). Conserva la ruta original `POST /uploads/module/trigger-vectorization`
 * para no romper el frontend.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class VectorizationController {
  constructor(
    private readonly courseService: CourseService,
    private readonly vectorizationService: VectorizationService,
  ) {}

  @Post('module/trigger-vectorization')
  async triggerVectorization(
    @Body() body: { courseId: string; moduleId: string },
    @Request() req: RequestWithUser,
  ) {
    const { courseId, moduleId } = body;
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new ForbiddenException('Curso no encontrado o acceso denegado');
    }

    // Fire-and-forget: la extraccion + embeddings puede tardar; no bloqueamos
    // la respuesta HTTP (mismo comportamiento async que el webhook n8n).
    this.vectorizationService
      .ingestModule(courseId, moduleId)
      .then((r) =>
        console.log(`[vectorizacion] modulo ${moduleId}: ${r.files} archivos, ${r.chunks} fragmentos`),
      )
      .catch((err) =>
        console.error(`[vectorizacion] error modulo ${moduleId}:`, err?.message || err),
      );

    return { success: true, message: 'Vectorización iniciada exitosamente' };
  }
}
