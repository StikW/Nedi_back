import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  CourseGamification,
  COURSE_GAMIFICATION_TABLE,
  GAMIFICATION_MODULE_COMPLETE_BONUS,
  GAMIFICATION_POINTS_PER_CORRECT,
} from '../models/course-gamification.entity';
import { GamificationSummaryDto } from '../models/gamification.dto';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ModuleProgressService } from './module-progress.service';

@Injectable()
export class GamificationService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    @Inject(forwardRef(() => ModuleProgressService))
    private readonly moduleProgressService: ModuleProgressService,
  ) {}

  async registerAnswer(
    phoneNumber: string,
    courseId: string,
    isCorrect: boolean,
  ): Promise<GamificationSummaryDto> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const existing = await this.findOne(normalizedPhone, courseId);
    const now = new Date().toISOString();

    const base: CourseGamification = existing ?? {
      phoneNumber: normalizedPhone,
      courseId,
      points: 0,
      level: 0,
      currentStreak: 0,
      bestStreak: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      updatedAt: now,
    };

    let pointsEarned = 0;
    let currentStreak = base.currentStreak;

    if (isCorrect) {
      pointsEarned = GAMIFICATION_POINTS_PER_CORRECT;
      currentStreak = base.currentStreak + 1;
    } else {
      currentStreak = 0;
    }

    const updated: CourseGamification = {
      ...base,
      points: base.points + pointsEarned,
      currentStreak,
      bestStreak: Math.max(base.bestStreak, currentStreak),
      correctAnswers: base.correctAnswers + (isCorrect ? 1 : 0),
      totalAnswers: base.totalAnswers + 1,
      updatedAt: now,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: COURSE_GAMIFICATION_TABLE,
        Item: updated,
      }),
    );

    const message = isCorrect
      ? `+${pointsEarned} pts (Total: ${updated.points}) | Racha: ${updated.currentStreak}${updated.currentStreak >= 3 ? ' 🔥' : ''}`
      : `Sigue intentando. Puntos totales: ${updated.points}`;

    return {
      points: updated.points,
      level: updated.level,
      currentStreak: updated.currentStreak,
      bestStreak: updated.bestStreak,
      pointsEarned,
      leveledUp: false,
      message,
    };
  }

  async onModuleCompleted(
    phoneNumber: string,
    courseId: string,
    isNewCompletion: boolean,
  ): Promise<GamificationSummaryDto> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const completedModules = await this.moduleProgressService.findByPhoneNumberAndCourse(
      normalizedPhone,
      courseId,
    );
    const newLevel = completedModules.length;

    const existing = await this.findOne(normalizedPhone, courseId);
    const previousLevel = existing?.level ?? 0;
    const now = new Date().toISOString();

    const bonusPoints = isNewCompletion ? GAMIFICATION_MODULE_COMPLETE_BONUS : 0;
    const leveledUp = isNewCompletion && newLevel > previousLevel;

    const updated: CourseGamification = {
      phoneNumber: normalizedPhone,
      courseId,
      points: (existing?.points ?? 0) + bonusPoints,
      level: newLevel,
      currentStreak: existing?.currentStreak ?? 0,
      bestStreak: existing?.bestStreak ?? 0,
      correctAnswers: existing?.correctAnswers ?? 0,
      totalAnswers: existing?.totalAnswers ?? 0,
      updatedAt: now,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: COURSE_GAMIFICATION_TABLE,
        Item: updated,
      }),
    );

    let message = `Módulo completado. Puntos totales: ${updated.points}`;
    if (leveledUp) {
      message = `¡Subiste al nivel ${newLevel}! ${bonusPoints > 0 ? `+${bonusPoints} pts bonus. ` : ''}Total: ${updated.points} pts`;
    }

    return {
      points: updated.points,
      level: updated.level,
      currentStreak: updated.currentStreak,
      bestStreak: updated.bestStreak,
      pointsEarned: bonusPoints,
      leveledUp,
      message,
    };
  }

  async getSummary(phoneNumber: string, courseId: string): Promise<CourseGamification | null> {
    return this.findOne(this.normalizePhoneNumber(phoneNumber), courseId);
  }

  private async findOne(
    phoneNumber: string,
    courseId: string,
  ): Promise<CourseGamification | null> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: COURSE_GAMIFICATION_TABLE,
        Key: { phoneNumber, courseId },
      }),
    );

    return (result.Item as CourseGamification | undefined) ?? null;
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    let normalized = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
    if (normalized.startsWith('wa')) {
      normalized = normalized.substring(2);
    }
    return normalized;
  }
}
