import { IsString, IsNumber, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Student progress information
 */
export class StudentProgressDto {
  /** Student ID */
  @IsString()
  studentId!: string;

  /** Student name */
  @IsString()
  studentName!: string;

  /** Student phone number */
  @IsString()
  phoneNumber!: string;

  /** Completion percentage (0-100) */
  @IsNumber()
  completionPercentage!: number;

  /** Number of completed modules */
  @IsNumber()
  completedModules!: number;

  /** Total number of modules in the course */
  @IsNumber()
  totalModules!: number;

  /** When the student was enrolled */
  @IsString()
  enrolledAt!: string;

  /** Last module completion date (if any) */
  @IsString()
  lastCompletedAt?: string;

  /** Veces que el estudiante ha ingresado al sistema */
  @IsOptional()
  @IsNumber()
  loginCount?: number;

  /** Fecha de la última vez que ingresó (updatedAt del estudiante) */
  @IsOptional()
  @IsString()
  lastAccessAt?: string;
}

/**
 * Course completion statistics (optimized with COUNT)
 */
export class CourseCompletionStatsDto {
  /** Course ID */
  @IsString()
  courseId!: string;

  /** Course title */
  @IsString()
  courseTitle!: string;

  /** Total number of students enrolled */
  @IsNumber()
  totalStudents!: number;

  /** Total number of modules in the course */
  @IsNumber()
  totalModules!: number;

  /** Global completion rate (0-100) */
  @IsNumber()
  completionRate!: number;
}


/**
 * Paginated student progress response
 */
export class StudentProgressPaginatedDto {
  /** Course ID */
  @IsString()
  courseId!: string;

  /** Course title */
  @IsString()
  courseTitle!: string;

  /** Total number of students enrolled */
  @IsNumber()
  totalStudents!: number;

  /** Total number of modules in the course */
  @IsNumber()
  totalModules!: number;

  /** Student progress details (paginated) */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentProgressDto)
  studentProgress!: StudentProgressDto[];

  /** Pagination metadata */
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
