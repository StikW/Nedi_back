import { IsString, IsNotEmpty, IsMimeType } from 'class-validator';

/**
 * DTO for requesting a pre-signed upload URL (original)
 */
export class GetUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsMimeType()
  contentType: string;
}

/**
 * DTO for requesting a pre-signed upload URL for course images
 */
export class GetCourseUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsMimeType()
  contentType: string;
}

/**
 * DTO for requesting a pre-signed upload URL for module resources
 */
export class GetModuleUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsMimeType()
  contentType: string;
}

/**
 * DTO for the response of a pre-signed upload URL
 */
export class UploadUrlResponseDto {
  uploadUrl: string;
  fileKey: string;
}

/**
 * DTO for the response of a pre-signed download URL
 */
export class DownloadUrlResponseDto {
  downloadUrl: string;
}
