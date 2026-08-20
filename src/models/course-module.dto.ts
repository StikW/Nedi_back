import { IsString, IsNumber, IsEnum, IsArray, IsOptional, IsUrl, Min, ValidateNested, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ModuleStatus } from './course-module.entity';

/**
 * DTO for creating a new course module
 */
export class CreateCourseModuleDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(1)
  order: number;

  @IsOptional()
  @IsString()
  @IsUrl()
  content: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  activityUrl?: string;

  @IsEnum(ModuleStatus)
  status: ModuleStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModuleResourceDto)
  resources?: CreateModuleResourceDto[];
}

/**
 * DTO for updating an existing course module
 */
export class UpdateCourseModuleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  order?: number;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value != null)
  @IsString()
  @IsUrl()
  content?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '' && value != null)
  @IsString()
  @IsUrl()
  activityUrl?: string;

  @IsOptional()
  @IsEnum(ModuleStatus)
  status?: ModuleStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModuleResourceDto)
  resources?: CreateModuleResourceDto[];
}

/**
 * DTO for creating module resources
 */
export class CreateModuleResourceDto {
  @IsString()
  name: string;

  @IsUrl()
  url: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}


