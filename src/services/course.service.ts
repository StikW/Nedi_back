import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Course, COURSES_TABLE, CourseStatus } from '../models/course.entity';
import { CreateCourseDto, UpdateCourseDto } from '../models/course.dto';
import { User } from '../models/user.entity';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { StudentService } from './student.service';
import { CourseModuleService } from './course-module.service';
import { CourseCompletionStatsDto, StudentProgressDto, StudentProgressPaginatedDto } from '../models/course-stats.dto';
import { InstructorStatsDto } from '../models/instructor-stats.dto';
import { ModuleProgress, MODULE_PROGRESS_TABLE } from '../models/module-progress.entity';
import { USERS_TABLE } from '../models/user.entity';
import { STUDENTS_TABLE } from '../models/student.entity';
import { COURSE_MODULES_TABLE } from '../models/course-module.entity';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';

@Injectable()
export class CourseService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    @Inject(forwardRef(() => StudentService))
    private readonly studentService: StudentService,
    @Inject(forwardRef(() => CourseModuleService))
    private readonly courseModuleService: CourseModuleService,
  ) {}

  async create(createCourseDto: CreateCourseDto, instructor: User): Promise<Course> {
    const courseId = uuidv4();
    const course: Course = {
      id: courseId,
      ...createCourseDto,
      instructorId: instructor.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: createCourseDto.status || CourseStatus.DRAFT
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: COURSES_TABLE,
      Item: course
    }));

    return course;
  }

  async findAllByInstructor(instructorId: string): Promise<Course[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSES_TABLE,
      IndexName: 'instructorId-index',
      KeyConditionExpression: 'instructorId = :instructorId',
      ExpressionAttributeValues: {
        ':instructorId': instructorId
      }
    }));

    return (result.Items || []) as Course[];
  }

  /**
   * Get courses by instructor with pagination (cursor-based)
   */
  async findAllByInstructorPaginated(
    instructorId: string, 
    paginationDto: PaginationDto
  ): Promise<PaginatedResponseDto<Course>> {
    const { cursor, sortOrder = 'desc' } = paginationDto;
    
    // Fixed limit of 10 items per page
    const limit = 10;
    
    // Parse cursor if provided
    let exclusiveStartKey: any = undefined;
    if (cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
        exclusiveStartKey = {
          id: cursorData.id,
          instructorId: cursorData.instructorId
        };
        } catch (error) {
          // Invalid cursor provided, starting from beginning
        }
    }

    // Get paginated results
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSES_TABLE,
      IndexName: 'instructorId-index',
      KeyConditionExpression: 'instructorId = :instructorId',
      ExpressionAttributeValues: {
        ':instructorId': instructorId
      },
      ScanIndexForward: sortOrder === 'asc', // true for ascending, false for descending
      Limit: limit + 1, // Get one extra to check if there's a next page
      ExclusiveStartKey: exclusiveStartKey
    }));

    const allItems = (result.Items || []) as Course[];
    const courses = allItems.slice(0, limit); // Take only the requested limit
    const hasNext = allItems.length > limit;
    
    // Generate next cursor if there's a next page
    let nextCursor: string | undefined;
    if (hasNext && courses.length > 0) {
      // Use the last item from the current page as cursor
      const lastItem = courses[courses.length - 1];
      const cursorData = {
        id: lastItem.id,
        instructorId: lastItem.instructorId
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    return {
      data: courses,
      pagination: {
        limit,
        hasNext,
        nextCursor,
        sortOrder
      }
    };
  }

  async findOne(id: string, instructorId: string): Promise<Course | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: COURSES_TABLE,
      Key: { id }
    }));

    const course = result.Item as Course | undefined;
    return course?.instructorId === instructorId ? course : null;
  }

  async delete(id: string, instructorId: string): Promise<{
    success: boolean;
    deletedStudentsCount: number;
    deletedModulesCount: number;
    deletedProgressCount: number;
    deletedFilesCount: number;
  }> {
    // Primero verificar que el curso existe y pertenece al instructor
    const course = await this.findOne(id, instructorId);
    if (!course) {
      throw new Error('Course not found or access denied');
    }

    // Eliminar todos los estudiantes asociados al curso
    const deletedStudentsCount = await this.studentService.deleteByCourseId(id);

    // Eliminar todos los módulos del curso (esto también elimina sus progresos y archivos S3)
    const modulesResult = await this.courseModuleService.deleteByCourseId(id);

    // Eliminar el curso
    await this.dynamoClient.send(new DeleteCommand({
      TableName: COURSES_TABLE,
      Key: { id }
    }));

    return {
      success: true,
      deletedStudentsCount,
      deletedModulesCount: modulesResult.deletedModulesCount,
      deletedProgressCount: modulesResult.deletedProgressCount,
      deletedFilesCount: modulesResult.deletedFilesCount
    };
  }

  async update(id: string, updateCourseDto: UpdateCourseDto, instructorId: string): Promise<Course | null> {
    // Primero verificar que el curso existe y pertenece al instructor
    const existingCourse = await this.findOne(id, instructorId);
    if (!existingCourse) {
      return null;
    }

    // Preparar los datos actualizados
    const updatedCourse: Course = {
      ...existingCourse,
      ...updateCourseDto,
      updatedAt: new Date().toISOString()
    };

    // Guardar el curso actualizado
    await this.dynamoClient.send(new PutCommand({
      TableName: COURSES_TABLE,
      Item: updatedCourse
    }));

    return updatedCourse;
  }

  /**
   * Get course with basic module information
   */
  async findOneWithModules(id: string, instructorId: string): Promise<Course | null> {
    const course = await this.findOne(id, instructorId);
    if (!course) {
      return null;
    }

    // Note: This would require importing CourseModuleService
    // For now, return course without modules
    return course;
  }


  /**
   * Get module progresses for a specific course
   */
  private async getModuleProgressesByCourse(courseId: string): Promise<ModuleProgress[]> {
    const result = await this.dynamoClient.send(new ScanCommand({
      TableName: MODULE_PROGRESS_TABLE,
      FilterExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      }
    }));

    return (result.Items || []) as ModuleProgress[];
  }

  /**
   * Get student completion percentage for a specific course
   */
  async getStudentCompletionPercentage(courseId: string, phoneNumber: string, instructorId: string): Promise<{
    studentId: string;
    studentName: string;
    phoneNumber: string;
    completionPercentage: number;
    completedModules: number;
    totalModules: number;
    lastCompletedAt?: string;
  }> {
    // Verificar que el curso existe y pertenece al instructor
    const course = await this.findOne(courseId, instructorId);
    if (!course) {
      throw new Error('Curso no encontrado o no tienes permisos para ver las estadísticas');
    }

    // Buscar el estudiante por número de teléfono
    const students = await this.studentService.findByPhoneNumber(phoneNumber);
    const student = students.find(s => s.courseId === courseId);
    
    if (!student) {
      throw new Error('Estudiante no encontrado en este curso');
    }

    // Obtener módulos del curso (solo publicados)
    const modules = await this.courseModuleService.getPublishedModules(courseId);
    
    // Obtener progresos del estudiante
    const studentProgresses = await this.getModuleProgressesByCourse(courseId);
    const studentModuleProgresses = studentProgresses.filter(progress => 
      progress.phoneNumber === student.phoneNumber
    );
    
    const completedModules = studentModuleProgresses.length;
    const totalModules = modules.length;
    const completionPercentage = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
    
    const lastCompletedAt = studentModuleProgresses.length > 0 
      ? studentModuleProgresses.sort((a, b) => 
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        )[0].completedAt
      : undefined;

    return {
      studentId: student.id,
      studentName: student.name,
      phoneNumber: student.phoneNumber,
      completionPercentage,
      completedModules,
      totalModules,
      lastCompletedAt
    };
  }

  /**
   * Get instructor statistics across all courses
   */
  async getInstructorStats(instructorId: string): Promise<InstructorStatsDto> {
    // Obtener todos los cursos del instructor
    const courses = await this.findAllByInstructor(instructorId);
    
    if (courses.length === 0) {
      // Si no tiene cursos, devolver estadísticas vacías
      return {
        instructorId,
        instructorName: '', // Se llenará desde el controlador
        totalCourses: 0,
        totalStudents: 0,
        overallCompletionRate: 0,
        completedStudents: 0,
        notStartedStudents: 0,
        averageCompletionPercentage: 0
      };
    }

    // Obtener información del instructor
    const instructor = await this.getInstructorInfo(instructorId);
    
    // Calcular total de estudiantes de todos los cursos
    let totalStudents = 0;

    // Procesar cada curso para obtener solo el total de estudiantes
    for (const course of courses) {
      try {
        const students = await this.studentService.findAllByCourse(course.id, instructorId);
        totalStudents += students.length;
      } catch (error) {
        // Si hay error obteniendo estudiantes de un curso, continuar con los demás
        console.warn(`Error obteniendo estudiantes del curso ${course.id}:`, error);
      }
    }

    return {
      instructorId,
      instructorName: instructor?.name || 'Instructor',
      totalCourses: courses.length,
      totalStudents,
      overallCompletionRate: 0,
      completedStudents: 0,
      notStartedStudents: 0,
      averageCompletionPercentage: 0
    };
  }

  /**
   * Get instructor information by ID
   */
  private async getInstructorInfo(instructorId: string): Promise<User | null> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { id: instructorId }
      }));

      return result.Item as User | undefined || null;
    } catch (error) {
      console.warn(`Error obteniendo información del instructor ${instructorId}:`, error);
      return null;
    }
  }

  /**
   * Get course completion statistics (optimized with COUNT)
   */
  async getCourseStatsOptimized(courseId: string, instructorId: string): Promise<CourseCompletionStatsDto> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.findOne(courseId, instructorId);
    if (!course) {
      throw new Error('Curso no encontrado o no tienes permisos para ver las estadísticas');
    }

    // Obtener datos con COUNT (muy rápido)
    const [totalStudents, totalModules, totalCompletions] = await Promise.all([
      this.countStudentsByCourse(courseId, instructorId),
      this.countPublishedModulesByCourse(courseId),
      this.countModuleProgressesByCourse(courseId)
    ]);

    // Calcular tasa de finalización
    const totalExpectedCompletions = totalStudents * totalModules;
    const completionRate = totalExpectedCompletions > 0 
      ? Math.round((totalCompletions / totalExpectedCompletions) * 100)
      : 0;

    return {
      courseId: course.id,
      courseTitle: course.title,
      totalStudents,
      totalModules,
      completionRate
    };
  }

  /**
   * Get paginated student progress for a course
   */
  async getStudentProgressPaginated(
    courseId: string, 
    instructorId: string, 
    paginationDto: PaginationDto
  ): Promise<StudentProgressPaginatedDto> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.findOne(courseId, instructorId);
    if (!course) {
      throw new Error('Curso no encontrado o no tienes permisos para ver el progreso de estudiantes');
    }

    // Obtener datos base
    const students = await this.studentService.findAllByCourse(courseId, instructorId);
    const modules = await this.courseModuleService.getPublishedModules(courseId);
    const moduleProgresses = await this.getModuleProgressesByCourse(courseId);

    // Paginar estudiantes
    const { page = 1, limit = 10 } = paginationDto;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedStudents = students.slice(startIndex, endIndex);

    // Calcular progreso solo para estudiantes de la página actual
    const studentProgress = paginatedStudents.map(student => {
      const studentProgresses = moduleProgresses.filter(progress => 
        progress.phoneNumber === student.phoneNumber
      );
      
      const completedModules = studentProgresses.length;
      const totalModules = modules.length;
      const completionPercentage = totalModules > 0 
        ? Math.round((completedModules / totalModules) * 100) 
        : 0;
      
      const lastCompletedAt = studentProgresses.length > 0 
        ? studentProgresses.sort((a, b) => 
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
          )[0].completedAt
        : undefined;

      return {
        studentId: student.id,
        studentName: student.name,
        phoneNumber: student.phoneNumber,
        completionPercentage,
        completedModules,
        totalModules,
        enrolledAt: student.enrolledAt,
        lastCompletedAt,
        loginCount: student.loginCount ?? 0,
        lastAccessAt: student.updatedAt
      };
    });

    // Calcular metadatos de paginación
    const totalPages = Math.ceil(students.length / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return {
      courseId: course.id,
      courseTitle: course.title,
      totalStudents: students.length,
      totalModules: modules.length,
      studentProgress,
      pagination: {
        page,
        limit,
        totalPages,
        hasNext,
        hasPrev
      }
    };
  }

  /**
   * Count students by course (optimized)
   */
  private async countStudentsByCourse(courseId: string, instructorId: string): Promise<number> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: STUDENTS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      Select: 'COUNT' // Solo contar, no traer datos
    }));

    return result.Count || 0;
  }

  /**
   * Count published modules by course (optimized)
   */
  private async countPublishedModulesByCourse(courseId: string): Promise<number> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSE_MODULES_TABLE,
      IndexName: 'courseId-order-index',
      KeyConditionExpression: 'courseId = :courseId',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':courseId': courseId,
        ':status': 'published'
      },
      Select: 'COUNT' // Solo contar, no traer datos
    }));

    return result.Count || 0;
  }

  /**
   * Count module progresses by course (optimized)
   */
  private async countModuleProgressesByCourse(courseId: string): Promise<number> {
    const result = await this.dynamoClient.send(new ScanCommand({
      TableName: MODULE_PROGRESS_TABLE,
      FilterExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      Select: 'COUNT' // Solo contar, no traer datos
    }));

    return result.Count || 0;
  }

}