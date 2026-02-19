import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * DTO for completing a module
 */
export class CompleteModuleDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  moduleId: string;

  @IsString()
  courseId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  timeSpentMinutes?: number;
}
