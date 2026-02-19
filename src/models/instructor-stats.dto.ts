import { IsString, IsNumber } from 'class-validator';

/**
 * Instructor statistics DTO
 */
export class InstructorStatsDto {
  /** Instructor ID */
  @IsString()
  instructorId!: string;

  /** Instructor name */
  @IsString()
  instructorName!: string;

  /** Total number of courses created by the instructor */
  @IsNumber()
  totalCourses!: number;

  /** Total number of students across all courses */
  @IsNumber()
  totalStudents!: number;

  /** Overall completion rate across all courses (0-100) */
  @IsNumber()
  overallCompletionRate!: number;

  /** Number of students who completed at least one course (100%) */
  @IsNumber()
  completedStudents!: number;

  /** Number of students who haven't started any course (0%) */
  @IsNumber()
  notStartedStudents!: number;

  /** Average completion percentage across all students */
  @IsNumber()
  averageCompletionPercentage!: number;
}
