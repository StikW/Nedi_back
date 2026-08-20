import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CourseModule, COURSE_MODULES_TABLE, ModuleStatus, ModuleResource } from '../models/course-module.entity';
import { CreateCourseModuleDto, UpdateCourseModuleDto } from '../models/course-module.dto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ModuleProgressService } from './module-progress.service';
import { StudentProgressCleanupService } from './student-progress-cleanup.service';
import { UploadsService } from './uploads.service';
import { RagService } from './agent/rag.service';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CourseModuleService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly moduleProgressService: ModuleProgressService,
    private readonly uploadsService: UploadsService,
    private readonly ragService: RagService,
    private readonly studentProgressCleanupService: StudentProgressCleanupService,
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

    // Prepare update expression (SET non-empty fields, REMOVE cleared optional URLs)
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    Object.keys(updateModuleDto).forEach((key) => {
      const value = updateModuleDto[key as keyof UpdateCourseModuleDto];
      if (value === undefined) return;

      expressionAttributeNames[`#${key}`] = key;

      if (value === '') {
        removeParts.push(`#${key}`);
        return;
      }

      setParts.push(`#${key} = :${key}`);
      expressionAttributeValues[`:${key}`] = value;
    });

    setParts.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    if (setParts.length === 0 && removeParts.length === 0) {
      return existingModule;
    }

    const updateClauses = [
      setParts.length > 0 ? `SET ${setParts.join(', ')}` : '',
      removeParts.length > 0 ? `REMOVE ${removeParts.join(', ')}` : '',
    ].filter(Boolean);

    await this.dynamoClient.send(new UpdateCommand({
      TableName: COURSE_MODULES_TABLE,
      Key: { id },
      UpdateExpression: updateClauses.join(' '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: Object.keys(expressionAttributeValues).length
        ? expressionAttributeValues
        : undefined,
      ReturnValues: 'ALL_NEW'
    }));

    if (updateModuleDto.resources !== undefined) {
      await this.syncRemovedModuleResources(
        courseId,
        id,
        existingModule.resources,
        updateModuleDto.resources,
      );
    }

    // Return updated module
    return this.findOne(id);
  }

  /**
   * Al actualizar resources, elimina de S3 los PDFs que ya no estan en la lista
   * y limpia vectores Pinecone para re-vectorizar con el material nuevo.
   */
  private async syncRemovedModuleResources(
    courseId: string,
    moduleId: string,
    previousResources: ModuleResource[] | undefined,
    nextResources: ModuleResource[],
  ): Promise<void> {
    const previousKeys = this.resourceKeysFromUrls(previousResources);
    const nextKeys = new Set(this.resourceKeysFromUrls(nextResources));
    const removedKeys = previousKeys.filter((key) => !nextKeys.has(key));

    if (removedKeys.length === 0) return;

    try {
      await this.uploadsService.deleteModuleFileKeys(removedKeys);
    } catch (error: any) {
      console.warn(
        `Warning: no se pudieron eliminar archivos S3 del modulo ${moduleId}:`,
        error?.message || error,
      );
    }

    try {
      await this.ragService.deleteModuleVectors(courseId, moduleId);
    } catch (error: any) {
      console.warn(
        `Warning: no se pudieron limpiar vectores Pinecone del modulo ${moduleId}:`,
        error?.message || error,
      );
    }
  }

  private resourceKeysFromUrls(resources?: ModuleResource[]): string[] {
    return (resources || [])
      .map((resource) => this.uploadsService.s3KeyFromResourceUrl(resource.url))
      .filter((key): key is string => !!key);
  }

  /**
   * Delete a course module, all associated module progress records, and S3 folder
   */
  async delete(id: string, courseId: string): Promise<{ 
    success: boolean; 
    deletedProgressCount: number; 
    deletedFilesCount: number;
    deletedQuestionBanks: number;
    deletedQuestionProgress: number;
    deletedAgentStates: number;
  }> {
    const module = await this.findOneByCourse(id, courseId);
    if (!module) {
      throw new NotFoundException('Module not found or does not belong to the specified course');
    }

    // Eliminar todos los progresos asociados al módulo (ModuleProgress)
    const deletedProgressCount = await this.moduleProgressService.deleteByModuleId(id);

    // Banco de preguntas, Progress por pregunta y AgentState del módulo
    let deletedQuestionBanks = 0;
    let deletedQuestionProgress = 0;
    let deletedAgentStates = 0;
    try {
      const purged = await this.studentProgressCleanupService.purgeModule(courseId, id);
      deletedQuestionBanks = purged.questionBanks;
      deletedQuestionProgress = purged.questionProgress;
      deletedAgentStates = purged.agentState;
    } catch (error) {
      console.warn(`Warning: Failed to purge module data for ${id}:`, error.message);
    }

    // Eliminar la carpeta del módulo en S3
    let deletedFilesCount = 0;
    try {
      deletedFilesCount = await this.uploadsService.deleteModuleFolder(courseId, id);
    } catch (error) {
      console.warn(`Warning: Failed to delete S3 folder for module ${id}:`, error.message);
    }

    // Eliminar vectores del módulo en Pinecone
    try {
      await this.ragService.deleteModuleVectors(courseId, id);
    } catch (error) {
      console.warn(`Warning: Failed to delete Pinecone vectors for module ${id}:`, error.message);
    }

    // Eliminar el módulo
    await this.dynamoClient.send(new DeleteCommand({
      TableName: COURSE_MODULES_TABLE,
      Key: { id }
    }));

    return { 
      success: true, 
      deletedProgressCount,
      deletedFilesCount,
      deletedQuestionBanks,
      deletedQuestionProgress,
      deletedAgentStates,
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
    deletedCourseAssetsCount: number;
    pineconeNamespaceDeleted: boolean;
  }> {
    // Buscar todos los módulos del curso
    const modules = await this.findAllByCourse(courseId);
    
    let totalDeletedProgress = 0;
    let totalDeletedFiles = 0;

    if (modules.length > 0) {
      // Eliminar cada módulo (progresos, S3 por módulo, vectores por módulo, DynamoDB)
      for (const module of modules) {
        try {
          const result = await this.delete(module.id, courseId);
          totalDeletedProgress += result.deletedProgressCount;
          totalDeletedFiles += result.deletedFilesCount;
        } catch (error) {
          console.warn(`Warning: Failed to delete module ${module.id}:`, error.message);
        }
      }
    }

    const external = await this.purgeCourseExternalAssets(courseId);

    return {
      deletedModulesCount: modules.length,
      deletedProgressCount: totalDeletedProgress,
      deletedFilesCount: totalDeletedFiles + external.deletedCourseAssetsCount,
      deletedCourseAssetsCount: external.deletedCourseAssetsCount,
      pineconeNamespaceDeleted: external.pineconeNamespaceDeleted,
    };
  }

  /** S3 restante del curso + namespace Pinecone (tras borrar módulos). */
  private async purgeCourseExternalAssets(courseId: string): Promise<{
    deletedCourseAssetsCount: number;
    pineconeNamespaceDeleted: boolean;
  }> {
    let deletedCourseAssetsCount = 0;
    try {
      deletedCourseAssetsCount = await this.uploadsService.deleteCourseAssets(courseId);
    } catch (error) {
      console.warn(`Warning: Failed to delete S3 assets for course ${courseId}:`, error.message);
    }

    let pineconeNamespaceDeleted = false;
    try {
      await this.ragService.deleteCourseNamespace(courseId);
      pineconeNamespaceDeleted = true;
    } catch (error) {
      console.warn(`Warning: Failed to delete Pinecone namespace for course ${courseId}:`, error.message);
    }

    return { deletedCourseAssetsCount, pineconeNamespaceDeleted };
  }
}
