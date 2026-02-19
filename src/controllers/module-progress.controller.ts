import { 
  Controller, 
  Post, 
  Body, 
  UseGuards, 
  Request, 
  HttpStatus,
  HttpException
} from '@nestjs/common';
import { ModuleProgressService } from '../services/module-progress.service';
import { CompleteModuleDto } from '../models/module-progress.dto';
import { ModuleProgress } from '../models/module-progress.entity';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('module-progress')
@UseGuards(JwtAuthGuard)
export class ModuleProgressController {
  constructor(private readonly moduleProgressService: ModuleProgressService) {}

  /**
   * Completar un módulo
   * POST /module-progress/complete
   * Body: { phoneNumber, moduleId, courseId, timeSpentMinutes? }
   */
  @Post('complete')
  async completeModule(
    @Body() body: { phoneNumber: string; moduleId: string; courseId: string; timeSpentMinutes?: number },
    @Request() req: RequestWithUser
  ): Promise<{ success: boolean; message: string; progress: ModuleProgress }> {
    try {
      const completeModuleDto: CompleteModuleDto = {
        phoneNumber: body.phoneNumber,
        moduleId: body.moduleId,
        courseId: body.courseId,
        timeSpentMinutes: body.timeSpentMinutes
      };

      const progress = await this.moduleProgressService.completeModule(completeModuleDto);
      
      return {
        success: true,
        message: 'Módulo completado exitosamente',
        progress
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al completar el módulo',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
