import { IsBoolean, IsString } from 'class-validator';

export class RegisterAnswerDto {
  @IsString()
  phoneNumber!: string;

  @IsString()
  courseId!: string;

  @IsBoolean()
  isCorrect!: boolean;
}

export class GamificationSummaryDto {
  points!: number;
  level!: number;
  currentStreak!: number;
  bestStreak!: number;
  pointsEarned!: number;
  leveledUp!: boolean;
  message!: string;
}
