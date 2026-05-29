import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GamificationService } from '../services/gamification.service';
import { RegisterAnswerDto, GamificationSummaryDto } from '../models/gamification.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  /**
   * Register the result of an evaluated answer (called from n8n AI Respuestas tool).
   * POST /gamification/answer
   */
  @Post('answer')
  async registerAnswer(
    @Body() body: RegisterAnswerDto,
  ): Promise<{ success: boolean; gamification: GamificationSummaryDto }> {
    try {
      const gamification = await this.gamificationService.registerAnswer(
        body.phoneNumber,
        body.courseId,
        body.isCorrect,
      );

      return { success: true, gamification };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al registrar gamificación de respuesta',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
