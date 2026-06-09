import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UploadsService } from '../services/uploads.service';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';
import { CourseService } from '../services/course.service';
import { 
  GetUploadUrlDto,
  GetCourseUploadUrlDto, 
  GetModuleUploadUrlDto, 
  UploadUrlResponseDto, 
  DownloadUrlResponseDto 
} from '../models/uploads.dto';
import { ConfigService } from '@nestjs/config';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly courseService: CourseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a pre-signed URL for uploading a file (original endpoint)
   */
  @Post('presigned-url')
  async getUploadUrl(
    @Body() body: GetUploadUrlDto,
    @Request() req: RequestWithUser,
  ): Promise<UploadUrlResponseDto> {
    const { courseId, filename, contentType } = body;

    // TODO: Add validation to ensure the user has access to the course
    // This could be done by checking if the user is the instructor of the course

    return this.uploadsService.getUploadUrl(courseId, filename, contentType);
  }

  /**
   * Generate a pre-signed URL for uploading a course image
   */
  @Post('course/presigned-url')
  async getCourseUploadUrl(
    @Body() body: GetCourseUploadUrlDto,
    @Request() req: RequestWithUser,
  ): Promise<UploadUrlResponseDto> {
    const { courseId, filename, contentType } = body;

    // TODO: Add validation to ensure the user has access to the course
    // This could be done by checking if the user is the instructor of the course

    return this.uploadsService.getUploadUrl(courseId, filename, contentType);
  }

  /**
   * Generate a pre-signed URL for uploading module resources
   */
  @Post('module/presigned-url')
  async getModuleUploadUrl(
    @Body() body: GetModuleUploadUrlDto,
    @Request() req: RequestWithUser,
  ): Promise<UploadUrlResponseDto> {
    const { courseId, moduleId, filename, contentType } = body;

    // TODO: Add validation to ensure the user has access to the course and module
    // This could be done by checking if the user is the instructor of the course

    return this.uploadsService.getModuleUploadUrl(courseId, moduleId, filename, contentType);
  }
  /**
   * Generate a pre-signed URL for downloading a file (original endpoint)
   */
  @Get(':courseId/:fileKey')
  async getDownloadUrl(
    @Param('courseId') courseId: string,
    @Param('fileKey') fileKey: string,
    @Request() req: RequestWithUser,
  ): Promise<DownloadUrlResponseDto> {
    // TODO: Add validation to ensure the user has access to the course
    // This could be done by checking if the user is the instructor or a student of the course

    const downloadUrl = await this.uploadsService.getDownloadUrl(courseId, fileKey);
    return { downloadUrl };
  }

  /**
   * Generate a pre-signed URL for downloading a course file
   */
  @Get('course/:courseId/:fileKey')
  async getCourseDownloadUrl(
    @Param('courseId') courseId: string,
    @Param('fileKey') fileKey: string,
    @Request() req: RequestWithUser,
  ): Promise<DownloadUrlResponseDto> {
    // TODO: Add validation to ensure the user has access to the course
    // This could be done by checking if the user is the instructor or a student of the course

    const downloadUrl = await this.uploadsService.getDownloadUrl(courseId, fileKey);
    return { downloadUrl };
  }

  /**
   * Generate a pre-signed URL for downloading a module resource
   */
  @Get('module/:courseId/:moduleId/:fileKey')
  async getModuleDownloadUrl(
    @Param('courseId') courseId: string,
    @Param('moduleId') moduleId: string,
    @Param('fileKey') fileKey: string,
    @Request() req: RequestWithUser,
  ): Promise<DownloadUrlResponseDto> {
    // TODO: Add validation to ensure the user has access to the course and module
    // This could be done by checking if the user is the instructor or a student of the course

    const downloadUrl = await this.uploadsService.getModuleDownloadUrl(courseId, moduleId, fileKey);
    return { downloadUrl };
  }
}
