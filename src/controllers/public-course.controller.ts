import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { CourseService } from '../services/course.service';
import { StudentService } from '../services/student.service';
import { PublicEnrollDto } from '../models/public-enroll.dto';
import { CreateStudentDto } from '../models/student.dto';
import { Student } from '../models/student.entity';

/**
 * Endpoints públicos (sin JWT) para vista previa y registro a cursos públicos publicados.
 */
@Controller('public/courses')
export class PublicCourseController {
  constructor(
    private readonly courseService: CourseService,
    private readonly studentService: StudentService,
  ) {}

  /**
   * Datos mínimos del curso para la página de registro (solo si es público y publicado).
   */
  @Get(':courseId/preview')
  async preview(@Param('courseId') courseId: string) {
    const course = await this.courseService.findPublishedPublicCourse(courseId);
    if (!course) {
      throw new NotFoundException('Curso no disponible o no es público');
    }
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      imageUrl: course.imageUrl,
      category: course.category,
      objectives: course.objectives,
    };
  }

  /**
   * Inscribir estudiante en un curso público publicado.
   */
  @Post(':courseId/enroll')
  @HttpCode(HttpStatus.CREATED)
  async enroll(
    @Param('courseId') courseId: string,
    @Body() dto: PublicEnrollDto,
  ): Promise<Student> {
    const course = await this.courseService.findPublishedPublicCourse(courseId);
    if (!course) {
      throw new NotFoundException('Curso no disponible o no es público');
    }
    const createDto: CreateStudentDto = {
      name: dto.name,
      phoneNumber: dto.phoneNumber,
      courseId,
    };
    try {
      return await this.studentService.create(createDto, course.instructorId);
    } catch (e: unknown) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.CONFLICT) {
        throw new ConflictException('Ya estás inscrito en este curso con ese número');
      }
      throw e;
    }
  }
}
