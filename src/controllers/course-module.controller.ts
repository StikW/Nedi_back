import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { CourseModuleService } from '../services/course-module.service';
import { CreateCourseModuleDto, UpdateCourseModuleDto } from '../models/course-module.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { CourseService } from '../services/course.service';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('courses/:courseId/modules')
@UseGuards(JwtAuthGuard)
export class CourseModuleController {
  constructor(
    private readonly courseModuleService: CourseModuleService,
    private readonly courseService: CourseService,
  ) {}

  /**
   * Create a new module for a course
   */
  @Post()
  async create(
    @Param('courseId') courseId: string,
    @Body() createModuleDto: CreateCourseModuleDto,
    @Request() req: RequestWithUser,
  ) {
    // Verify the user is the instructor of the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    return this.courseModuleService.create(createModuleDto, courseId);
  }

  /**
   * Get all modules for a course
   */
  @Get()
  async findAll(
    @Param('courseId') courseId: string, 
    @Query() paginationDto: PaginationDto,
    @Request() req: RequestWithUser
  ) {
    // Verify the user has access to the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    // Si se proporcionan parámetros de paginación, usar paginación
    if (paginationDto.cursor || paginationDto.sortOrder) {
      return this.courseModuleService.findAllByCoursePaginated(courseId, paginationDto);
    }
    
    // Si no hay parámetros de paginación, retornar todos los módulos (comportamiento original)
    return this.courseModuleService.findAllByCourse(courseId);
  }

  /**
   * Get published modules for a course (for students)
   */
  @Get('published')
  async getPublishedModules(@Param('courseId') courseId: string) {
    return this.courseModuleService.getPublishedModules(courseId);
  }

  /**
   * Get a specific module
   */
  @Get(':id')
  async findOne(
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ) {
    // Verify the user has access to the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    const module = await this.courseModuleService.findOneByCourse(id, courseId);
    if (!module) {
      throw new Error('Module not found');
    }

    return module;
  }

  /**
   * Update a module
   */
  @Put(':id')
  async update(
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Body() updateModuleDto: UpdateCourseModuleDto,
    @Request() req: RequestWithUser,
  ) {
    // Verify the user is the instructor of the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    return this.courseModuleService.update(id, updateModuleDto, courseId);
  }

  /**
   * Delete a module, all associated progress records, and S3 folder
   */
  @Delete(':id')
  async remove(
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ) {
    // Verify the user is the instructor of the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    const result = await this.courseModuleService.delete(id, courseId);
    
    return {
      message:
        `Module deleted successfully. Also deleted ${result.deletedProgressCount} module progress records, ` +
        `${result.deletedQuestionProgress} question progress records, ${result.deletedQuestionBanks} question bank(s), ` +
        `${result.deletedAgentStates} agent state(s), and ${result.deletedFilesCount} files from S3.`,
      deletedProgressCount: result.deletedProgressCount,
      deletedFilesCount: result.deletedFilesCount,
      deletedQuestionBanks: result.deletedQuestionBanks,
      deletedQuestionProgress: result.deletedQuestionProgress,
      deletedAgentStates: result.deletedAgentStates,
    };
  }

  /**
   * Reorder modules within a course
   */
  @Put('reorder')
  async reorderModules(
    @Param('courseId') courseId: string,
    @Body() moduleOrders: { id: string; order: number }[],
    @Request() req: RequestWithUser,
  ) {
    // Verify the user is the instructor of the course
    const course = await this.courseService.findOne(courseId, req.user.id);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    return this.courseModuleService.reorderModules(courseId, moduleOrders);
  }
}
