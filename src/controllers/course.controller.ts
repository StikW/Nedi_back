import { Controller, Get, Post, Body, Param, UseGuards, Request, Delete, HttpCode, Put, Query } from '@nestjs/common';
import { CourseService } from '../services/course.service';
import { CreateCourseDto, UpdateCourseDto } from '../models/course.dto';
import { Course } from '../models/course.entity';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';
import { CourseCompletionStatsDto, StudentProgressPaginatedDto } from '../models/course-stats.dto';
import { InstructorStatsDto } from '../models/instructor-stats.dto';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Post()
  async create(
    @Body() createCourseDto: CreateCourseDto,
    @Request() req: RequestWithUser
  ): Promise<Course> {
    return this.courseService.create(createCourseDto, req.user);
  }

  @Get()
  async findAllByInstructor(
    @Query() paginationDto: PaginationDto,
    @Request() req: RequestWithUser
  ): Promise<Course[] | PaginatedResponseDto<Course>> {
    // Si se proporcionan parámetros de paginación, usar paginación
    if (paginationDto.cursor || paginationDto.sortOrder) {
      return this.courseService.findAllByInstructorPaginated(req.user.id, paginationDto);
    }
    
    // Si no hay parámetros de paginación, retornar todos los cursos (comportamiento original)
    return this.courseService.findAllByInstructor(req.user.id);
  }

  /**
   * Get instructor statistics across all courses
   */
  @Get('instructor/stats')
  async getInstructorStats(
    @Request() req: RequestWithUser
  ): Promise<InstructorStatsDto> {
    const stats = await this.courseService.getInstructorStats(req.user.id);
    
    // Asegurar que el nombre del instructor esté actualizado
    stats.instructorName = req.user.name;
    
    return stats;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<Course | null> {
    return this.courseService.findOne(id, req.user.id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCourseDto: UpdateCourseDto,
    @Request() req: RequestWithUser
  ): Promise<Course> {
    const updatedCourse = await this.courseService.update(id, updateCourseDto, req.user.id);
    if (!updatedCourse) {
      throw new Error('Curso no encontrado o no tienes permisos para actualizarlo');
    }
    return updatedCourse;
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ) {
    const result = await this.courseService.delete(id, req.user.id);
    
    return {
      message: `Course deleted successfully. Also deleted ${result.deletedStudentsCount} students, ${result.deletedModulesCount} modules, ${result.deletedProgressCount} progress records, ${result.deletedFilesCount} files from S3${result.pineconeNamespaceDeleted ? ', and Pinecone namespace' : ''}.`,
      deletedStudentsCount: result.deletedStudentsCount,
      deletedModulesCount: result.deletedModulesCount,
      deletedProgressCount: result.deletedProgressCount,
      deletedFilesCount: result.deletedFilesCount,
      deletedCourseAssetsCount: result.deletedCourseAssetsCount,
      pineconeNamespaceDeleted: result.pineconeNamespaceDeleted,
    };
  }

  /**
   * Get course completion statistics (optimized with COUNT)
   */
  @Get(':id/stats')
  async getCourseStats(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<CourseCompletionStatsDto> {
    return this.courseService.getCourseStatsOptimized(id, req.user.id);
  }

  /**
   * Get paginated student progress for a course
   */
  @Get(':id/student-progress')
  async getStudentProgressPaginated(
    @Param('id') id: string,
    @Query() paginationDto: PaginationDto,
    @Request() req: RequestWithUser
  ): Promise<StudentProgressPaginatedDto> {
    return this.courseService.getStudentProgressPaginated(id, req.user.id, paginationDto);
  }

  /**
   * Get student completion percentage for a specific course (legacy endpoint)
   */
  @Get(':id/student-progress/:phoneNumber')
  async getStudentProgress(
    @Param('id') id: string,
    @Param('phoneNumber') phoneNumber: string,
    @Request() req: RequestWithUser
  ) {
    return this.courseService.getStudentCompletionPercentage(id, phoneNumber, req.user.id);
  }

} 