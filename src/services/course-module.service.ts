import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CourseModule, COURSE_MODULES_TABLE, ModuleStatus } from '../models/course-module.entity';
import { CreateCourseModuleDto, UpdateCourseModuleDto } from '../models/course-module.dto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ModuleProgressService } from './module-progress.service';
import { UploadsService } from './uploads.service';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CourseModuleService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly moduleProgressService: ModuleProgressService,
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Create a new course module
   */
  async create(createModuleDto: CreateCourseModuleDto, courseId: string): Promise<CourseModule> {
    const module: CourseModule = {
      id: uuidv4(),
      courseId,
      ...createModuleDto,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: COURSE_MODULES_TABLE,
      Item: module
    }));

    return module;
  }

  /**
   * Find all modules for a specific course
   */
  async findAllByCourse(courseId: string): Promise<CourseModule[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSE_MODULES_TABLE,
      IndexName: 'courseId-order-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      ScanIndexForward: true // Order by order field ascending
    }));

    return (result.Items || []) as CourseModule[];
  }

  /**
   * Get modules by course with pagination (cursor-based)
   */
  async findAllByCoursePaginated(
    courseId: string, 
    paginationDto: PaginationDto
  ): Promise<PaginatedResponseDto<CourseModule>> {
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
          courseId: cursorData.courseId,
          order: cursorData.order
        };
      } catch (error) {
        // Invalid cursor provided, starting from beginning
      }
    }

    // Get paginated results
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSE_MODULES_TABLE,
      IndexName: 'courseId-order-index',
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      ScanIndexForward: sortOrder === 'asc', // true for ascending, false for descending
      Limit: limit + 1, // Get one extra to check if there's a next page
      ExclusiveStartKey: exclusiveStartKey
    }));

    const allItems = (result.Items || []) as CourseModule[];
    const modules = allItems.slice(0, limit); // Take only the requested limit
    const hasNext = allItems.length > limit;
    
    // Generate next cursor if there's a next page
    let nextCursor: string | undefined;
    if (hasNext && modules.length > 0) {
      // Use the last item from the current page as cursor
      const lastItem = modules[modules.length - 1];
      const cursorData = {
        id: lastItem.id,
        courseId: lastItem.courseId,
        order: lastItem.order
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    return {
      data: modules,
      pagination: {
        limit,
        hasNext,
        nextCursor,
        sortOrder
      }
    };
  }

  /**
   * Find a specific module by ID
   */
  async findOne(id: string): Promise<CourseModule | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: COURSE_MODULES_TABLE,
      Key: { id }
    }));

    return result.Item as CourseModule | null;
  }

  /**
   * Find a module by ID and course ID (for validation)
   */
  async findOneByCourse(id: string, courseId: string): Promise<CourseModule | null> {
    const module = await this.findOne(id);
    return module?.courseId === courseId ? module : null;
  }

  /**
   * Update a course module
   */
  async update(id: string, updateModuleDto: UpdateCourseModuleDto, courseId: string): Promise<CourseModule | null> {
    const existingModule = await this.findOneByCourse(id, courseId);
    if (!existingModule) {
      throw new NotFoundException('Module not found or does not belong to the specified course');
    }

    // Prepare update expression
    const updateExpression: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    Object.keys(updateModuleDto).forEach((key) => {
      if (updateModuleDto[key as keyof UpdateCourseModuleDto] !== undefined) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updateModuleDto[key as keyof UpdateCourseModuleDto];
      }
    });

    // Add updatedAt
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    if (updateExpression.length === 0) {
      return existingModule;
    }

    await this.dynamoClient.send(new UpdateCommand({
      TableName: COURSE_MODULES_TABLE,
      Key: { id },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));

    // Return updated module
    return this.findOne(id);
  }

  /**
   * Delete a course module, all associated module progress records, and S3 folder
   */
  async delete(id: string, courseId: string): Promise<{ 
    success: boolean; 
    deletedProgressCount: number; 
    deletedFilesCount: number; 
  }> {
    const module = await this.findOneByCourse(id, courseId);
    if (!module) {
      throw new NotFoundException('Module not found or does not belong to the specified course');
    }

    // Eliminar todos los progresos asociados al módulo
    const deletedProgressCount = await this.moduleProgressService.deleteByModuleId(id);

    // Eliminar la carpeta del módulo en S3
    let deletedFilesCount = 0;
    try {
      deletedFilesCount = await this.uploadsService.deleteModuleFolder(courseId, id);
    } catch (error) {
      console.warn(`Warning: Failed to delete S3 folder for module ${id}:`, error.message);
      // No lanzamos error aquí para no interrumpir la eliminación del módulo
    }

    // Eliminar el módulo
    await this.dynamoClient.send(new DeleteCommand({
      TableName: COURSE_MODULES_TABLE,
      Key: { id }
    }));

    return { 
      success: true, 
      deletedProgressCount,
      deletedFilesCount
    };
  }

  /**
   * Reorder modules within a course
   */
  async reorderModules(courseId: string, moduleOrders: { id: string; order: number }[]): Promise<CourseModule[]> {
    // Validate that all modules belong to the course
    const existingModules = await this.findAllByCourse(courseId);
    const existingModuleIds = new Set(existingModules.map(m => m.id));
    
    for (const moduleOrder of moduleOrders) {
      if (!existingModuleIds.has(moduleOrder.id)) {
        throw new BadRequestException(`Module ${moduleOrder.id} does not belong to course ${courseId}`);
      }
    }

    // Update each module's order
    const updatePromises = moduleOrders.map(async ({ id, order }) => {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: COURSE_MODULES_TABLE,
        Key: { id },
        UpdateExpression: 'SET #order = :order, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#order': 'order',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':order': order,
          ':updatedAt': new Date().toISOString()
        }
      }));
    });

    await Promise.all(updatePromises);

    // Return updated modules in new order
    return this.findAllByCourse(courseId);
  }

  /**
   * Get modules by status for a course
   */
  async findByStatus(courseId: string, status: ModuleStatus): Promise<CourseModule[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: COURSE_MODULES_TABLE,
      IndexName: 'courseId-status-index',
      KeyConditionExpression: 'courseId = :courseId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':courseId': courseId,
        ':status': status
      }
    }));

    return (result.Items || []) as CourseModule[];
  }

  /**
   * Get published modules for a course (for students)
   */
  async getPublishedModules(courseId: string): Promise<CourseModule[]> {
    return this.findByStatus(courseId, ModuleStatus.PUBLISHED);
  }

  /**
   * Eliminar todos los módulos de un curso y sus archivos S3 asociados
   */
  async deleteByCourseId(courseId: string): Promise<{ 
    deletedModulesCount: number; 
    deletedProgressCount: number; 
    deletedFilesCount: number; 
  }> {
    // Buscar todos los módulos del curso
    const modules = await this.findAllByCourse(courseId);
    
    if (modules.length === 0) {
      return { deletedModulesCount: 0, deletedProgressCount: 0, deletedFilesCount: 0 };
    }

    let totalDeletedProgress = 0;
    let totalDeletedFiles = 0;

    // Eliminar cada módulo (esto ya elimina sus progresos y archivos S3)
    for (const module of modules) {
      try {
        const result = await this.delete(module.id, courseId);
        totalDeletedProgress += result.deletedProgressCount;
        totalDeletedFiles += result.deletedFilesCount;
      } catch (error) {
        console.warn(`Warning: Failed to delete module ${module.id}:`, error.message);
        // Continuar con el siguiente módulo
      }
    }

    return {
      deletedModulesCount: modules.length,
      deletedProgressCount: totalDeletedProgress,
      deletedFilesCount: totalDeletedFiles
    };
  }
}
