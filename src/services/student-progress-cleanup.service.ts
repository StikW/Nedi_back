import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { AgentState, AGENT_STATE_TABLE } from '../models/agent-state.entity';
import {
  progressPhoneKey,
  STUDENT_PROGRESS_TABLE,
  StudentQuestionProgress,
  COURSE_MODULE_QUESTIONS_TABLE,
  LEGACY_QUESTION_BANK_TABLE,
} from '../models/course-module-questions.entity';
import { ModuleProgressService } from './module-progress.service';

export interface EnrollmentPurgeResult {
  moduleProgress: number;
  questionProgress: number;
  agentState: number;
}

export interface ModulePurgeResult {
  questionBanks: number;
  questionProgress: number;
  agentState: number;
}

/**
 * Elimina el progreso del agente y de módulos asociado a un estudiante en un curso.
 * Al borrar un módulo, {@link purgeModule} también elimina su banco de preguntas.
 */
@Injectable()
export class StudentProgressCleanupService {
  private readonly logger = new Logger(StudentProgressCleanupService.name);

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly moduleProgressService: ModuleProgressService,
  ) {}

  /** Dígitos E.164 sin `+` ni prefijo `wa` (igual que tabla Students). */
  normalizeBarePhone(phoneNumber: string): string {
    let normalized = phoneNumber.trim();
    if (normalized.startsWith('+')) {
      normalized = normalized.substring(1);
    }
    if (normalized.startsWith('wa')) {
      normalized = normalized.substring(2);
    }
    return normalized;
  }

  private progressPhoneVariants(phoneNumber: string): string[] {
    const bare = this.normalizeBarePhone(phoneNumber);
    return [...new Set([bare, `wa${bare}`, progressPhoneKey(bare)])];
  }

  private phonesMatch(studentBare: string, storedPhone: string): boolean {
    return this.normalizeBarePhone(storedPhone) === studentBare;
  }

  async purgeEnrollment(
    phoneNumber: string,
    courseId: string,
    moduleIds: string[],
  ): Promise<EnrollmentPurgeResult> {
    const barePhone = this.normalizeBarePhone(phoneNumber);

    const moduleProgress = await this.moduleProgressService.deleteByPhoneAndCourse(
      barePhone,
      courseId,
    );
    const questionProgress = await this.deleteQuestionProgress(
      barePhone,
      courseId,
      moduleIds,
    );
    const agentState = await this.deleteAgentStatesForCourse(barePhone, courseId);

    this.logger.log(
      `Progreso purgado para ${barePhone} en curso ${courseId}: ` +
        `ModuleProgress=${moduleProgress}, Progress=${questionProgress}, AgentState=${agentState}`,
    );

    return { moduleProgress, questionProgress, agentState };
  }

  /**
   * Limpia todo lo asociado a un módulo: banco de preguntas, avance por pregunta (Progress)
   * y estados del agente que referencian ese módulo.
   */
  async purgeModule(courseId: string, moduleId: string): Promise<ModulePurgeResult> {
    const questionBanks = await this.deleteQuestionBanks(courseId, moduleId);
    const questionProgress = await this.deleteProgressByModuleId(moduleId);
    const agentState = await this.deleteAgentStatesForModule(courseId, moduleId);

    this.logger.log(
      `Datos del módulo ${moduleId} purgados: ` +
        `questionBanks=${questionBanks}, Progress=${questionProgress}, AgentState=${agentState}`,
    );

    return { questionBanks, questionProgress, agentState };
  }

  private async deleteQuestionBanks(courseId: string, moduleId: string): Promise<number> {
    let deleted = 0;
    const key = { courseId, moduleId };

    for (const tableName of [COURSE_MODULE_QUESTIONS_TABLE, LEGACY_QUESTION_BANK_TABLE]) {
      try {
        await this.dynamoClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: key,
          }),
        );
        deleted++;
      } catch {
        /* tabla legacy puede no existir */
      }
    }

    return deleted;
  }

  private async deleteProgressByModuleId(moduleId: string): Promise<number> {
    const keys: Array<{ phoneNumber: string; moduleId: string }> = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: STUDENT_PROGRESS_TABLE,
          FilterExpression: 'moduleId = :moduleId',
          ExpressionAttributeValues: { ':moduleId': moduleId },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of (result.Items || []) as StudentQuestionProgress[]) {
        keys.push({ phoneNumber: item.phoneNumber, moduleId: item.moduleId });
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return this.batchDeleteByKeys(STUDENT_PROGRESS_TABLE, keys);
  }

  private async deleteAgentStatesForModule(courseId: string, moduleId: string): Promise<number> {
    const toDelete: AgentState[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: AGENT_STATE_TABLE,
          FilterExpression: 'courseId = :courseId',
          ExpressionAttributeValues: { ':courseId': courseId },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of (result.Items || []) as AgentState[]) {
        if (
          item.moduleId === moduleId ||
          item.offeredNextModuleId === moduleId ||
          item.introShownForModuleId === moduleId
        ) {
          toDelete.push(item);
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    if (toDelete.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const state of toDelete) {
      await this.dynamoClient.send(
        new DeleteCommand({
          TableName: AGENT_STATE_TABLE,
          Key: { id: state.id },
        }),
      );
      deleted++;
    }

    return deleted;
  }

  private async deleteQuestionProgress(
    barePhone: string,
    courseId: string,
    moduleIds: string[],
  ): Promise<number> {
    const keysToDelete = new Map<string, { phoneNumber: string; moduleId: string }>();

    for (const moduleId of moduleIds) {
      for (const phoneKey of this.progressPhoneVariants(barePhone)) {
        const mapKey = `${phoneKey}#${moduleId}`;
        keysToDelete.set(mapKey, { phoneNumber: phoneKey, moduleId });
      }
    }

    const scanned = await this.scanProgressByCourse(barePhone, courseId);
    for (const item of scanned) {
      const mapKey = `${item.phoneNumber}#${item.moduleId}`;
      keysToDelete.set(mapKey, {
        phoneNumber: item.phoneNumber,
        moduleId: item.moduleId,
      });
    }

    if (keysToDelete.size === 0) {
      return 0;
    }

    return this.batchDeleteByKeys(
      STUDENT_PROGRESS_TABLE,
      Array.from(keysToDelete.values()),
    );
  }

  private async scanProgressByCourse(
    barePhone: string,
    courseId: string,
  ): Promise<StudentQuestionProgress[]> {
    const items: StudentQuestionProgress[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: STUDENT_PROGRESS_TABLE,
          FilterExpression: 'courseId = :courseId',
          ExpressionAttributeValues: { ':courseId': courseId },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of (result.Items || []) as StudentQuestionProgress[]) {
        if (this.phonesMatch(barePhone, item.phoneNumber)) {
          items.push(item);
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  private async deleteAgentStatesForCourse(
    barePhone: string,
    courseId: string,
  ): Promise<number> {
    const toDelete: AgentState[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: AGENT_STATE_TABLE,
          FilterExpression: 'courseId = :courseId',
          ExpressionAttributeValues: { ':courseId': courseId },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of (result.Items || []) as AgentState[]) {
        if (this.phonesMatch(barePhone, item.phoneNumber)) {
          toDelete.push(item);
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    if (toDelete.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const state of toDelete) {
      await this.dynamoClient.send(
        new DeleteCommand({
          TableName: AGENT_STATE_TABLE,
          Key: { id: state.id },
        }),
      );
      deleted++;
    }

    return deleted;
  }

  /** Elimina estados conversacionales del agente vinculados a una instancia Evolution. */
  async purgeByEvolutionInstance(instance: string): Promise<number> {
    if (!instance?.trim()) return 0;
    const prefix = `${instance.trim()}#`;
    let deleted = 0;
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: AGENT_STATE_TABLE,
          FilterExpression: 'begins_with(#id, :prefix)',
          ExpressionAttributeNames: { '#id': 'id' },
          ExpressionAttributeValues: { ':prefix': prefix },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of result.Items || []) {
        await this.dynamoClient.send(
          new DeleteCommand({
            TableName: AGENT_STATE_TABLE,
            Key: { id: (item as AgentState).id },
          }),
        );
        deleted++;
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    if (deleted > 0) {
      this.logger.log(`AgentState purgado para instancia ${instance}: ${deleted} registro(s)`);
    }
    return deleted;
  }

  private async batchDeleteByKeys(
    tableName: string,
    keys: Array<Record<string, string>>,
  ): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (let i = 0; i < keys.length; i += 25) {
      const batch = keys.slice(i, i + 25);
      await this.dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: batch.map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }
}
