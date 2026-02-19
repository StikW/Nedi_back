import { IsString, IsEnum, IsUrl, MinLength, MaxLength, IsOptional } from 'class-validator';
import { CourseStatus, CourseCategory, COURSE_CATEGORIES } from './course.entity';

/**
 * Data transfer object for creating a new course
 */
export class CreateCourseDto {
  /** Course title (5-100 characters) */
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  title!: string;

  /** Course description (20-1000 characters) */
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  description!: string;

  /** Course category */
  @IsEnum(COURSE_CATEGORIES)
  category!: CourseCategory;

  /** URL to course image */
  @IsUrl()
  imageUrl!: string;

  /** Course learning objectives (minimum 20 characters) */
  @IsString()
  @MinLength(20)
  objectives!: string;

  /** Course prerequisites (minimum 10 characters if provided) */
  @IsString()
  @MinLength(10)
  @IsOptional()
  prerequisites?: string;

  /** Course status (defaults to 'draft') */
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;
}

/**
 * Data transfer object for updating an existing course
 */
export class UpdateCourseDto {
  /** Course title (5-100 characters) */
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  @IsOptional()
  title?: string;

  /** Course description (20-1000 characters) */
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  /** Course category */
  @IsEnum(COURSE_CATEGORIES)
  @IsOptional()
  category?: CourseCategory;

  /** URL to course image */
  @IsUrl()
  @IsOptional()
  imageUrl?: string;

  /** Course learning objectives (minimum 20 characters) */
  @IsString()
  @MinLength(20)
  @IsOptional()
  objectives?: string;

  /** Course prerequisites (minimum 10 characters if provided) */
  @IsString()
  @MinLength(10)
  @IsOptional()
  prerequisites?: string;

  /** Course status */
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;
} 