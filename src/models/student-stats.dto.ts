import { IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Course progress information for a student
 */
export class StudentCourseProgressDto {
  /** Course title */
  @IsString()
  courseTitle!: string;

  /** Completion percentage for this course (0-100) */
  @IsNumber()
  completionPercentage!: number;

  /** Number of completed modules in this course */
  @IsNumber()
  completedModules!: number;

  /** Total number of modules in this course */
  @IsNumber()
  totalModules!: number;

  /** Last module completion date in this course (if any) */
  @IsString()
  lastCompletedAt?: string;
}

/**
 * Student statistics across all courses
 */
export class StudentStatsDto {
  /** Student ID */
  @IsString()
  studentId!: string;

  /** Student name */
  @IsString()
  studentName!: string;

  /** Student phone number */
  @IsString()
  phoneNumber!: string;

  /** Total number of courses enrolled */
  @IsNumber()
  totalCourses!: number;

  /** Number of courses completed (100%) */
  @IsNumber()
  completedCourses!: number;

  /** Number of courses in progress (1-99%) */
  @IsNumber()
  inProgressCourses!: number;

  /** Number of courses not started (0%) */
  @IsNumber()
  notStartedCourses!: number;

  /** Overall completion rate across all courses (0-100) */
  @IsNumber()
  overallCompletionRate!: number;

  /** Average completion percentage across all courses */
  @IsNumber()
  averageCompletionPercentage!: number;

  /** Total modules completed across all courses */
  @IsNumber()
  totalCompletedModules!: number;

  /** Total modules available across all courses */
  @IsNumber()
  totalAvailableModules!: number;

  /** Course progress details */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentCourseProgressDto)
  courseProgress!: StudentCourseProgressDto[];

  /** Last activity date (most recent module completion) */
  @IsString()
  lastActivityAt?: string;
}
