import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  UseGuards, 
  Request, 
  Delete, 
  HttpCode, 
  Put,
  HttpStatus,
  HttpException,
  Query,
  UseInterceptors,
  UploadedFile
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentService } from '../services/student.service';
import { CreateStudentDto, UpdateStudentDto, ImportStudentsResponseDto } from '../models/student.dto';
import { StudentStatsDto } from '../models/student-stats.dto';
import { Student } from '../models/student.entity';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Post()
  async create(
    @Body() createStudentDto: CreateStudentDto,
    @Request() req: RequestWithUser
  ): Promise<Student> {
    try {
      return await this.studentService.create(createStudentDto, req.user.id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al crear el estudiante',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('course/:courseId')
  async findAllByCourse(
    @Param('courseId') courseId: string,
    @Query() paginationDto: PaginationDto,
    @Request() req: RequestWithUser
  ): Promise<Student[] | PaginatedResponseDto<Student>> {
    try {
      // Si se proporcionan parámetros de paginación, usar paginación
      if (paginationDto.cursor || paginationDto.sortOrder) {
        return await this.studentService.findAllByCoursePaginated(courseId, req.user.id, paginationDto);
      }
      
      // Si no hay parámetros de paginación, retornar todos los estudiantes (comportamiento original)
      return await this.studentService.findAllByCourse(courseId, req.user.id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener los estudiantes del curso',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<Student | null> {
    const student = await this.studentService.findOne(id);
    if (!student) {
      throw new HttpException('Estudiante no encontrado', HttpStatus.NOT_FOUND);
    }
    return student;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateStudentDto: UpdateStudentDto,
    @Request() req: RequestWithUser
  ): Promise<Student> {
    try {
      const updatedStudent = await this.studentService.update(id, updateStudentDto, req.user.id);
      if (!updatedStudent) {
        throw new HttpException('Estudiante no encontrado', HttpStatus.NOT_FOUND);
      }
      return updatedStudent;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al actualizar el estudiante',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<void> {
    try {
      const deleted = await this.studentService.delete(id, req.user.id);
      if (!deleted) {
        throw new HttpException('Estudiante no encontrado', HttpStatus.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al eliminar el estudiante',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('search/phone')
  async findByPhoneNumber(
    @Query('phone') phoneNumber: string,
    @Request() req: RequestWithUser
  ): Promise<Student[]> {
    if (!phoneNumber) {
      throw new HttpException('Número de teléfono es requerido', HttpStatus.BAD_REQUEST);
    }
    
    try {
      return await this.studentService.findByPhoneNumber(phoneNumber);
    } catch (error) {
      throw new HttpException(
        'Error al buscar estudiantes por teléfono',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Verificar si un estudiante ya existe en un curso específico
   */
  @Get('check/:courseId/:phoneNumber')
  async checkStudentExists(
    @Param('courseId') courseId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Request() req: RequestWithUser
  ): Promise<{ exists: boolean; student?: Student }> {
    try {
      // Verificar que el curso pertenece al instructor
      const course = await this.studentService['courseService'].findOne(courseId, req.user.id);
      if (!course) {
        throw new HttpException(
          'Curso no encontrado o no tienes permisos para acceder a este curso',
          HttpStatus.FORBIDDEN
        );
      }

      const existingStudent = await this.studentService.findByPhoneAndCourse(phoneNumber, courseId);
      
      return {
        exists: !!existingStudent,
        student: existingStudent || undefined
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al verificar la existencia del estudiante',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('course/:courseId/import')
  @UseInterceptors(FileInterceptor('file'))
  async importStudents(
    @Param('courseId') courseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: RequestWithUser
  ): Promise<ImportStudentsResponseDto> {
    try {
      // Validar que se subió un archivo
      if (!file) {
        throw new HttpException(
          'No se proporcionó ningún archivo',
          HttpStatus.BAD_REQUEST
        );
      }

      // Validar que es un archivo CSV
      if (!file.mimetype.includes('text/csv') && !file.originalname.endsWith('.csv')) {
        throw new HttpException(
          'El archivo debe ser un CSV válido',
          HttpStatus.BAD_REQUEST
        );
      }

      // Validar tamaño del archivo (máximo 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        throw new HttpException(
          'El archivo es demasiado grande. Máximo 5MB',
          HttpStatus.BAD_REQUEST
        );
      }

      return await this.studentService.importStudentsFromCSV(
        file.buffer,
        courseId,
        req.user.id
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al importar estudiantes',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get student statistics across all courses (Admin only)
   */
  @Get(':phoneNumber/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getStudentStats(
    @Param('phoneNumber') phoneNumber: string,
    @Request() req: RequestWithUser
  ): Promise<StudentStatsDto> {
    try {
      return await this.studentService.getStudentStats(phoneNumber);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener estadísticas del estudiante',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
