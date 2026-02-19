import { Controller, Post, Get, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
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
  private readonly n8nWebhookUrl: string;
  constructor(private readonly uploadsService: UploadsService, private readonly courseService: CourseService, private readonly configService: ConfigService) {
    this.n8nWebhookUrl = this.configService.get<string>('N8N_WEBHOOK_URL')
    || 'https://n8n.thagent.online/webhook/vectorizacion';
  }

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
  @Post('module/trigger-vectorization')
  async triggerVectorization(
    @Body() body: { courseId: string, moduleId: string},
    @Request() req: RequestWithUser,
  ) {
    const { courseId, moduleId } = body
    const course = await this.courseService.findOne(courseId, req.user.id);
    if(!course) {
      throw new ForbiddenException('Curso no encontrado o acceso denegado');
    }
    try {
      const response = await fetch(this.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: courseId,
          moduleId: moduleId,
        }),
      });
      if(!response.ok) {
        console.error('Error al triggerizar la vectorización en n8n', response.statusText);
        return {
          success: false,
          message: `Error al procesar la vectorización: ${response.statusText}`,
        }
      }
      return {
        success: true,
        message: 'Vectorización iniciada exitosamente',
      }
    } catch (error) {
      console.error('Error al conectar con el webhook de n8n', error);
      return {
        success: false,
        message: `Error al conectar con n8n: ${error.message}`,
      }
    }
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
