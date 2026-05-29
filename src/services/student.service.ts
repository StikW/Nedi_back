import { Inject, Injectable, Logger, HttpException, HttpStatus, forwardRef } from '@nestjs/common';
import { Student, STUDENTS_TABLE } from '../models/student.entity';
import { CreateStudentDto, UpdateStudentDto, ImportStudentDto, ImportStudentsResponseDto } from '../models/student.dto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, BatchWriteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { StudentStatsDto, StudentCourseProgressDto } from '../models/student-stats.dto';
import { v4 as uuidv4 } from 'uuid';
import { CourseService } from './course.service';
import { CourseModuleService } from './course-module.service';
import { ModuleProgressService } from './module-progress.service';
import { ReminderService } from './reminder.service';
import * as csv from 'csv-parser';
import { Readable } from 'stream';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    @Inject(forwardRef(() => CourseService))
    private readonly courseService: CourseService,
    @Inject(forwardRef(() => CourseModuleService))
    private readonly courseModuleService: CourseModuleService,
    @Inject(forwardRef(() => ModuleProgressService))
    private readonly moduleProgressService: ModuleProgressService,
    @Inject(forwardRef(() => ReminderService))
    private readonly reminderService: ReminderService,
  ) {}

  /**
   * Dispara la plantilla `nedi_bienvenida_curso` para un estudiante reci\u00e9n
   * creado. Es fire-and-forget: si falla el WhatsApp, NO se rompe la creaci\u00f3n
   * del estudiante. El error queda en los logs.
   */
  private async dispatchWelcome(student: Student): Promise<void> {
    try {
      const result = await this.reminderService.sendWelcomeToStudent(student);
      if (!result.sent) {
        this.logger.warn(
          `Bienvenida no enviada al estudiante ${student.id} (${student.phoneNumber}): ` +
            `${result.skippedReason || result.error || 'sin motivo'}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Error inesperado disparando bienvenida al estudiante ${student.id}: ${err?.message || err}`,
      );
    }
  }

  /**
   * Normaliza el número de teléfono removiendo el símbolo + si está presente
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    return phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  }

  async create(createStudentDto: CreateStudentDto, instructorId: string): Promise<Student> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.courseService.findOne(createStudentDto.courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'Curso no encontrado o no tienes permisos para agregar estudiantes a este curso',
        HttpStatus.FORBIDDEN
      );
    }

    const normalizedPhone = this.normalizePhoneNumber(createStudentDto.phoneNumber);
    
    // Verificar si ya existe un estudiante con el mismo teléfono en el mismo curso
    const existingStudent = await this.findByPhoneAndCourse(normalizedPhone, createStudentDto.courseId);
    if (existingStudent) {
      throw new HttpException(
        `Ya existe un estudiante con el número de teléfono ${createStudentDto.phoneNumber} inscrito en este curso`,
        HttpStatus.CONFLICT
      );
    }

    const studentId = uuidv4();
    
    const student: Student = {
      id: studentId,
      name: createStudentDto.name,
      phoneNumber: normalizedPhone,
      courseId: createStudentDto.courseId,
      instructorId: instructorId,
      enrolledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: STUDENTS_TABLE,
      Item: student
    }));

    // Dispara la bienvenida por WhatsApp en background. No bloqueamos la
    // respuesta HTTP: el estudiante ya quedo creado en DynamoDB; si Meta
    // falla, queda en los logs para reenv\u00edo manual via /reminders/run/welcome.
    this.dispatchWelcome(student);

    return student;
  }

  async findAllByCourse(courseId: string, instructorId: string): Promise<Student[]> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.courseService.findOne(courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'Curso no encontrado o no tienes permisos para ver los estudiantes de este curso',
        HttpStatus.FORBIDDEN
      );
    }

    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: STUDENTS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      }
    }));

    return (result.Items || []) as Student[];
  }

  /**
   * Get students by course with pagination (cursor-based)
   */
  async findAllByCoursePaginated(
    courseId: string, 
    instructorId: string,
    paginationDto: PaginationDto
  ): Promise<PaginatedResponseDto<Student>> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.courseService.findOne(courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'Curso no encontrado o no tienes permisos para ver los estudiantes de este curso',
        HttpStatus.FORBIDDEN
      );
    }

    const { cursor, sortOrder = 'asc' } = paginationDto;
    
    // Fixed limit of 10 items per page
    const limit = 10;
    
    // Parse cursor if provided
    let exclusiveStartKey: any = undefined;
    if (cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
        exclusiveStartKey = {
          id: cursorData.id,
          courseId: cursorData.courseId
        };
      } catch (error) {
        // Invalid cursor provided, starting from beginning
      }
    }

    // Get paginated results
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: STUDENTS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      ScanIndexForward: sortOrder === 'asc', // true for ascending, false for descending
      Limit: limit + 1, // Get one extra to check if there's a next page
      ExclusiveStartKey: exclusiveStartKey
    }));

    const allItems = (result.Items || []) as Student[];
    const students = allItems.slice(0, limit); // Take only the requested limit
    const hasNext = allItems.length > limit;
    
    // Generate next cursor if there's a next page
    let nextCursor: string | undefined;
    if (hasNext && students.length > 0) {
      // Use the last item from the current page as cursor
      const lastItem = students[students.length - 1];
      const cursorData = {
        id: lastItem.id,
        courseId: lastItem.courseId
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    return {
      data: students,
      pagination: {
        limit,
        hasNext,
        nextCursor,
        sortOrder
      }
    };
  }

  async findOne(id: string): Promise<Student | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: STUDENTS_TABLE,
      Key: { id }
    }));

    return result.Item as Student | undefined || null;
  }

  async update(id: string, updateStudentDto: UpdateStudentDto, instructorId: string): Promise<Student | null> {
    // Primero verificar que el estudiante existe
    const existingStudent = await this.findOne(id);
    if (!existingStudent) {
      return null;
    }

    // Validar que el curso del estudiante pertenece al instructor
    const course = await this.courseService.findOne(existingStudent.courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'No tienes permisos para modificar este estudiante',
        HttpStatus.FORBIDDEN
      );
    }

    // Si se está actualizando el número de teléfono, verificar que no exista otro estudiante con el mismo teléfono en el mismo curso
    if (updateStudentDto.phoneNumber) {
      const normalizedPhone = this.normalizePhoneNumber(updateStudentDto.phoneNumber);
      
      // Solo verificar si el teléfono es diferente al actual
      if (normalizedPhone !== existingStudent.phoneNumber) {
        const existingStudentWithPhone = await this.findByPhoneAndCourse(normalizedPhone, existingStudent.courseId);
        if (existingStudentWithPhone && existingStudentWithPhone.id !== id) {
          throw new HttpException(
            `Ya existe un estudiante con el número de teléfono ${updateStudentDto.phoneNumber} inscrito en este curso`,
            HttpStatus.CONFLICT
          );
        }
      }
    }

    // Preparar los datos actualizados
    const updatedStudent: Student = {
      ...existingStudent,
      ...updateStudentDto,
      updatedAt: new Date().toISOString()
    };

    // Normalizar el teléfono si se está actualizando
    if (updateStudentDto.phoneNumber) {
      updatedStudent.phoneNumber = this.normalizePhoneNumber(updateStudentDto.phoneNumber);
    }

    // Guardar el estudiante actualizado
    await this.dynamoClient.send(new PutCommand({
      TableName: STUDENTS_TABLE,
      Item: updatedStudent
    }));

    return updatedStudent;
  }

  async delete(id: string, instructorId: string): Promise<boolean> {
    // Primero verificar que el estudiante existe
    const existingStudent = await this.findOne(id);
    if (!existingStudent) {
      return false;
    }

    // Validar que el curso del estudiante pertenece al instructor
    const course = await this.courseService.findOne(existingStudent.courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'No tienes permisos para eliminar este estudiante',
        HttpStatus.FORBIDDEN
      );
    }

    // Eliminar el estudiante
    await this.dynamoClient.send(new DeleteCommand({
      TableName: STUDENTS_TABLE,
      Key: { id }
    }));

    return true;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<Student[]> {
    // Normalizar el teléfono de búsqueda
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: STUDENTS_TABLE,
      IndexName: 'phoneNumber-index',
      KeyConditionExpression: 'phoneNumber = :phoneNumber',
      ExpressionAttributeValues: {
        ':phoneNumber': normalizedPhone
      }
    }));

    return (result.Items || []) as Student[];
  }

  /**
   * Buscar un estudiante por número de teléfono y curso específico
   */
  async findByPhoneAndCourse(phoneNumber: string, courseId: string): Promise<Student | null> {
    // Normalizar el teléfono de búsqueda
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    const result = await this.dynamoClient.send(new ScanCommand({
      TableName: STUDENTS_TABLE,
      FilterExpression: 'phoneNumber = :phoneNumber AND courseId = :courseId',
      ExpressionAttributeValues: {
        ':phoneNumber': normalizedPhone,
        ':courseId': courseId
      },
      Limit: 1 // Solo necesitamos saber si existe
    }));

    const students = result.Items as Student[] || [];
    return students.length > 0 ? students[0] : null;
  }

  /**
   * Escanear todos los estudiantes de todos los cursos.
   * Usado por el cron de recordatorios para evaluar inactividad.
   */
  async findAllStudents(): Promise<Student[]> {
    const students: Student[] = [];
    let exclusiveStartKey: any = undefined;

    do {
      const result = await this.dynamoClient.send(new ScanCommand({
        TableName: STUDENTS_TABLE,
        ExclusiveStartKey: exclusiveStartKey,
      }));

      if (result.Items) {
        students.push(...(result.Items as Student[]));
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return students;
  }

  /**
   * Marca la fecha del \u00faltimo env\u00edo de un tipo espec\u00edfico de recordatorio.
   * Soporta:
   *   - 'welcome'  \u2192 lastWelcomeSentAt
   *   - 'daily'    \u2192 lastDailyReminderSentAt (y lastReminderSentAt por compat)
   *   - 'weekly'   \u2192 lastWeeklyReflectionSentAt
   */
  async markReminderSent(
    id: string,
    type: 'welcome' | 'daily' | 'weekly' = 'daily',
    sentAt: string = new Date().toISOString(),
  ): Promise<void> {
    let updateExpression: string;
    const values: Record<string, string> = { ':sentAt': sentAt };

    switch (type) {
      case 'welcome':
        updateExpression = 'SET lastWelcomeSentAt = :sentAt, updatedAt = :sentAt';
        break;
      case 'weekly':
        updateExpression = 'SET lastWeeklyReflectionSentAt = :sentAt, updatedAt = :sentAt';
        break;
      case 'daily':
      default:
        updateExpression =
          'SET lastDailyReminderSentAt = :sentAt, lastReminderSentAt = :sentAt, updatedAt = :sentAt';
        break;
    }

    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: STUDENTS_TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /**
   * Eliminar todos los estudiantes asociados a un curso específico
   */
  async deleteByCourseId(courseId: string): Promise<number> {
    // Buscar todos los estudiantes del curso
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: STUDENTS_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      }
    }));

    const students = (result.Items || []) as Student[];
    
    if (students.length === 0) {
      return 0;
    }

    // Eliminar en lotes de 25 (límite de DynamoDB BatchWrite)
    const deletePromises = [];
    for (let i = 0; i < students.length; i += 25) {
      const batch = students.slice(i, i + 25);
      const deleteRequests = batch.map(student => ({
        DeleteRequest: {
          Key: { id: student.id }
        }
      }));

      deletePromises.push(
        this.dynamoClient.send(new BatchWriteCommand({
          RequestItems: {
            [STUDENTS_TABLE]: deleteRequests
          }
        }))
      );
    }

    await Promise.all(deletePromises);
    return students.length;
  }

  /**
   * Importa estudiantes masivamente desde un CSV
   * @param csvBuffer Buffer del archivo CSV
   * @param courseId ID del curso
   * @param instructorId ID del instructor
   * @returns Resultado de la importación
   */
  async importStudentsFromCSV(
    csvBuffer: Buffer, 
    courseId: string, 
    instructorId: string
  ): Promise<ImportStudentsResponseDto> {
    // Validar que el curso existe y pertenece al instructor
    const course = await this.courseService.findOne(courseId, instructorId);
    if (!course) {
      throw new HttpException(
        'Curso no encontrado o no tienes permisos para agregar estudiantes a este curso',
        HttpStatus.FORBIDDEN
      );
    }

    const students: ImportStudentDto[] = [];
    const errors: Array<{ row: number; name: string; phoneNumber: string; error: string }> = [];
    const createdStudents: Student[] = [];

    return new Promise((resolve, reject) => {
      const stream = Readable.from(csvBuffer.toString());
      
      stream
        .pipe(csv())
        .on('data', (row: any) => {
          try {
            // Validar que las columnas requeridas existen
            if (!row.name || !row.phonenumber) {
              errors.push({
                row: students.length + errors.length + 1,
                name: row.name || '',
                phoneNumber: row.phonenumber || '',
                error: 'Faltan campos requeridos (name, phonenumber)'
              });
              return;
            }

            // Validar formato del teléfono
            const phoneNumber = row.phonenumber.trim();
            if (!phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
              errors.push({
                row: students.length + errors.length + 1,
                name: row.name.trim(),
                phoneNumber,
                error: 'Formato de teléfono inválido'
              });
              return;
            }

            students.push({
              name: row.name.trim(),
              phoneNumber
            });
          } catch (error) {
            errors.push({
              row: students.length + errors.length + 1,
              name: row.name || '',
              phoneNumber: row.phonenumber || '',
              error: `Error al procesar fila: ${error.message}`
            });
          }
        })
        .on('end', async () => {
          try {
            // Procesar estudiantes en lotes
            const batchSize = 25; // Límite de DynamoDB BatchWrite
            let successCount = 0;
            let failedCount = 0;

            for (let i = 0; i < students.length; i += batchSize) {
              const batch = students.slice(i, i + batchSize);
              const batchResults = await this.processStudentBatch(batch, courseId, instructorId);
              
              successCount += batchResults.success;
              failedCount += batchResults.failed;
              createdStudents.push(...batchResults.createdStudents);
              errors.push(...batchResults.errors);
            }

            resolve({
              success: successCount,
              failed: failedCount + errors.length,
              errors,
              createdStudents: createdStudents.map(student => ({
                id: student.id,
                name: student.name,
                phoneNumber: student.phoneNumber,
                courseId: student.courseId,
                instructorId: student.instructorId,
                enrolledAt: student.enrolledAt,
                updatedAt: student.updatedAt
              }))
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(new HttpException(
            `Error al procesar el archivo CSV: ${error.message}`,
            HttpStatus.BAD_REQUEST
          ));
        });
    });
  }

  /**
   * Procesa un lote de estudiantes
   * @param students Lista de estudiantes a procesar
   * @param courseId ID del curso
   * @param instructorId ID del instructor
   * @returns Resultado del procesamiento del lote
   */
  private async processStudentBatch(
    students: ImportStudentDto[], 
    courseId: string, 
    instructorId: string
  ): Promise<{
    success: number;
    failed: number;
    createdStudents: Student[];
    errors: Array<{ row: number; name: string; phoneNumber: string; error: string }>;
  }> {
    const createdStudents: Student[] = [];
    const errors: Array<{ row: number; name: string; phoneNumber: string; error: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    // Verificar duplicados antes de crear
    const duplicateChecks = await Promise.all(
      students.map(async (student, index) => {
        const normalizedPhone = this.normalizePhoneNumber(student.phoneNumber);
        const existingStudent = await this.findByPhoneAndCourse(normalizedPhone, courseId);
        return { index, student, existingStudent };
      })
    );

    // Preparar elementos para BatchWrite
    const putRequests: any[] = [];
    const currentTime = new Date().toISOString();

    duplicateChecks.forEach(({ index, student, existingStudent }) => {
      if (existingStudent) {
        failedCount++;
        errors.push({
          row: index + 1,
          name: student.name,
          phoneNumber: student.phoneNumber,
          error: 'Ya existe un estudiante con este número de teléfono en el curso'
        });
      } else {
        const studentId = uuidv4();
        const normalizedPhone = this.normalizePhoneNumber(student.phoneNumber);
        
        const studentData: Student = {
          id: studentId,
          name: student.name,
          phoneNumber: normalizedPhone,
          courseId,
          instructorId,
          enrolledAt: currentTime,
          updatedAt: currentTime
        };

        putRequests.push({
          PutRequest: {
            Item: studentData
          }
        });

        createdStudents.push(studentData);
      }
    });

    // Ejecutar BatchWrite si hay elementos para crear
    if (putRequests.length > 0) {
      try {
        await this.dynamoClient.send(new BatchWriteCommand({
          RequestItems: {
            [STUDENTS_TABLE]: putRequests
          }
        }));
        successCount = putRequests.length;

        // Dispara la bienvenida en paralelo (best-effort). No detenemos la
        // importaci\u00f3n si alguna falla; los warnings quedan en logs.
        await Promise.allSettled(
          createdStudents.map((student) => this.dispatchWelcome(student)),
        );
      } catch (error) {
        // Si falla el BatchWrite, marcar todos como fallidos
        failedCount += putRequests.length;
        successCount = 0;
        putRequests.forEach((_, index) => {
          errors.push({
            row: index + 1,
            name: students[index].name,
            phoneNumber: students[index].phoneNumber,
            error: `Error al crear estudiante: ${error.message}`
          });
        });
      }
    }

    return {
      success: successCount,
      failed: failedCount,
      createdStudents,
      errors
    };
  }

  /**
   * Get student statistics across all courses
   */
  async getStudentStats(phoneNumber: string): Promise<StudentStatsDto> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    // Buscar todos los estudiantes con este número de teléfono
    const students = await this.findByPhoneNumber(normalizedPhone);
    
    if (students.length === 0) {
      throw new HttpException(
        'Estudiante no encontrado',
        HttpStatus.NOT_FOUND
      );
    }

    // Usar el primer estudiante como referencia (todos deberían tener el mismo nombre y teléfono)
    const firstStudent = students[0];
    
    // Obtener información de cada curso
    const courseProgressPromises = students.map(async (student) => {
      try {
        // Obtener información del curso
        const course = await this.courseService.findOne(student.courseId, student.instructorId);
        if (!course) {
          return null;
        }

        // Obtener módulos del curso (solo publicados)
        const modules = await this.courseModuleService.getPublishedModules(student.courseId);
        
        // Obtener progresos del estudiante en este curso
        const studentProgresses = await this.moduleProgressService.findByPhoneNumberAndCourse(
          normalizedPhone, 
          student.courseId
        );
        
        const completedModules = studentProgresses.length;
        const totalModules = modules.length;
        const completionPercentage = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

        // Obtener la fecha de la última actividad
        const lastCompletedAt = studentProgresses.length > 0 
          ? studentProgresses.sort((a, b) => 
              new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
            )[0].completedAt
          : undefined;

        return {
          courseTitle: course.title,
          completionPercentage,
          completedModules,
          totalModules,
          lastCompletedAt
        } as StudentCourseProgressDto;
      } catch (error) {
        console.error(`Error getting progress for course ${student.courseId}:`, error);
        return null;
      }
    });

    const courseProgressResults = await Promise.all(courseProgressPromises);
    const courseProgress = courseProgressResults.filter(result => result !== null);

    // Calcular estadísticas generales
    const totalCourses = courseProgress.length;
    const completedCourses = courseProgress.filter(cp => cp.completionPercentage === 100).length;
    const inProgressCourses = courseProgress.filter(cp => cp.completionPercentage > 0 && cp.completionPercentage < 100).length;
    const notStartedCourses = courseProgress.filter(cp => cp.completionPercentage === 0).length;

    const totalCompletedModules = courseProgress.reduce((sum, cp) => sum + cp.completedModules, 0);
    const totalAvailableModules = courseProgress.reduce((sum, cp) => sum + cp.totalModules, 0);
    
    const overallCompletionRate = totalAvailableModules > 0 
      ? Math.round((totalCompletedModules / totalAvailableModules) * 100) 
      : 0;

    const averageCompletionPercentage = totalCourses > 0
      ? Math.round(courseProgress.reduce((sum, cp) => sum + cp.completionPercentage, 0) / totalCourses)
      : 0;

    // Obtener la fecha de la última actividad
    const lastActivityAt = courseProgress
      .filter(cp => cp.lastCompletedAt)
      .sort((a, b) => new Date(b.lastCompletedAt!).getTime() - new Date(a.lastCompletedAt!).getTime())[0]?.lastCompletedAt;

    return {
      studentId: firstStudent.id,
      studentName: firstStudent.name,
      phoneNumber: normalizedPhone,
      totalCourses,
      completedCourses,
      inProgressCourses,
      notStartedCourses,
      overallCompletionRate,
      averageCompletionPercentage,
      totalCompletedModules,
      totalAvailableModules,
      courseProgress,
      lastActivityAt
    };
  }
}
