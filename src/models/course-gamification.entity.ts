/**
 * Gamification progress for a student within a specific course.
 */
export interface CourseGamification {
  /** Student phone number (normalized, without + or wa prefix) */
  phoneNumber: string;
  /** Course ID */
  courseId: string;
  /** Total points earned in this course */
  points: number;
  /** Level derived from completed modules in this course */
  level: number;
  /** Current consecutive correct-answer streak */
  currentStreak: number;
  /** Best streak achieved in this course */
  bestStreak: number;
  /** Total correct answers registered */
  correctAnswers: number;
  /** Total answers evaluated */
  totalAnswers: number;
  /** Last update timestamp (ISO) */
  updatedAt: string;
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export const COURSE_GAMIFICATION_TABLE = _tablePrefix + 'CourseGamification';

/** Points awarded per correct answer */
export const GAMIFICATION_POINTS_PER_CORRECT = 10;

/** Bonus points when completing a module */
export const GAMIFICATION_MODULE_COMPLETE_BONUS = 25;
