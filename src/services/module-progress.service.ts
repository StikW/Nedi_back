import { Injectable, Inject } from '@nestjs/common';
import { ModuleProgress, MODULE_PROGRESS_TABLE } from '../models/module-progress.entity';
import { CompleteModuleDto } from '../models/module-progress.dto';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class ModuleProgressService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  /**
   * Marcar un módulo como completado por un estudiante
   */
  async completeModule(completeModuleDto: CompleteModuleDto): Promise<ModuleProgress> {
    const normalizedPhone = this.normalizePhoneNumber(completeModuleDto.phoneNumber);
    const compositeId = `${normalizedPhone}#${completeModuleDto.moduleId}`;
    const existingProgress = await this.findOne(compositeId);
    const now = new Date().toISOString();

    if (existingProgress) {
      const updatedProgress: ModuleProgress = {
        ...existingProgress,
        timeSpentMinutes: completeModuleDto.timeSpentMinutes || existingProgress.timeSpentMinutes,
        completedAt: now,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: MODULE_PROGRESS_TABLE,
        Item: updatedProgress
      }));

      return updatedProgress;
    }

    const moduleProgress: ModuleProgress = {
      id: compositeId,
      phoneNumber: normalizedPhone,
      moduleId: completeModuleDto.moduleId,
      courseId: completeModuleDto.courseId,
      timeSpentMinutes: completeModuleDto.timeSpentMinutes || 0,
      completedAt: now,
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: MODULE_PROGRESS_TABLE,
      Item: moduleProgress
    }));

    return moduleProgress;
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    return phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  }

  private async findOne(id: string): Promise<ModuleProgress | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: MODULE_PROGRESS_TABLE,
      Key: { id }
    }));

    return result.Item as ModuleProgress | undefined || null;
  }

  async deleteByModuleId(moduleId: string): Promise<number> {
    const result = await this.dynamoClient.send(new ScanCommand({
      TableName: MODULE_PROGRESS_TABLE,
      FilterExpression: 'moduleId = :moduleId',
      ExpressionAttributeValues: {
        ':moduleId': moduleId
      }
    }));

    const progressRecords = result.Items as ModuleProgress[] || [];
    
    if (progressRecords.length === 0) {
      return 0;
    }

    const deletePromises = [];
    for (let i = 0; i < progressRecords.length; i += 25) {
      const batch = progressRecords.slice(i, i + 25);
      const deleteRequests = batch.map(record => ({
        DeleteRequest: {
          Key: { id: record.id }
        }
      }));

      deletePromises.push(
        this.dynamoClient.send(new BatchWriteCommand({
          RequestItems: {
            [MODULE_PROGRESS_TABLE]: deleteRequests
          }
        }))
      );
    }

    await Promise.all(deletePromises);
    return progressRecords.length;
  }

  async findByPhoneNumberAndCourse(phoneNumber: string, courseId: string): Promise<ModuleProgress[]> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    const result = await this.dynamoClient.send(new ScanCommand({
      TableName: MODULE_PROGRESS_TABLE,
      FilterExpression: 'phoneNumber = :phoneNumber AND courseId = :courseId',
      ExpressionAttributeValues: {
        ':phoneNumber': normalizedPhone,
        ':courseId': courseId
      }
    }));

    return (result.Items || []) as ModuleProgress[];
  }
}
