import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ModuleProgressService } from '../services/module-progress.service';
import { GamificationService } from '../services/gamification.service';
import { CompleteModuleDto } from '../models/module-progress.dto';
import { ModuleProgress } from '../models/module-progress.entity';
import { GamificationSummaryDto } from '../models/gamification.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('module-progress')
@UseGuards(JwtAuthGuard)
export class ModuleProgressController {
  constructor(
    private readonly moduleProgressService: ModuleProgressService,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Completar un módulo
   * POST /module-progress/complete
   * Body: { phoneNumber, moduleId, courseId, timeSpentMinutes? }
   */
  @Post('complete')
  async completeModule(
    @Body() body: { phoneNumber: string; moduleId: string; courseId: string; timeSpentMinutes?: number },
    @Request() req: RequestWithUser
  ): Promise<{
    success: boolean;
    message: string;
    progress: ModuleProgress;
    gamification: GamificationSummaryDto;
  }> {
    try {
      const completeModuleDto: CompleteModuleDto = {
        phoneNumber: body.phoneNumber,
        moduleId: body.moduleId,
        courseId: body.courseId,
        timeSpentMinutes: body.timeSpentMinutes
      };

      const { progress, isNewCompletion } =
        await this.moduleProgressService.completeModule(completeModuleDto);

      const gamification = await this.gamificationService.onModuleCompleted(
        body.phoneNumber,
        body.courseId,
        isNewCompletion,
      );

      return {
        success: true,
        message: gamification.leveledUp
          ? gamification.message
          : 'Módulo completado exitosamente',
        progress,
        gamification,
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
