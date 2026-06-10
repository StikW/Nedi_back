import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AgentState, AGENT_STATE_TABLE } from '../../models/agent-state.entity';
import {
  CourseModuleQuestions,
  COURSE_MODULE_QUESTIONS_TABLE,
  LEGACY_QUESTION_BANK_TABLE,
  ModuleQuestion,
  parseProgressStatus,
  progressPhoneKey,
  StudentQuestionProgress,
  STUDENT_PROGRESS_TABLE,
} from '../../models/course-module-questions.entity';
import { ConversationFlow } from './agent.types';

/**
 * Persistencia del estado del agente:
 *  - Estado conversacional por (instancia+telefono)  -> tabla AgentState
 *  - Banco de preguntas por (curso+modulo)            -> tabla CourseModuleQuestions
 *  - Avance de preguntas por (telefono+modulo)        -> tabla Progress
 */
@Injectable()
export class AgentStateService {
  private readonly logger = new Logger(AgentStateService.name);

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  private stateId(instance: string, phoneNumber: string): string {
    return `${instance}#${phoneNumber}`;
  }

  // ===== Estado conversacional =====

  async getState(instance: string, phoneNumber: string): Promise<AgentState | null> {
    try {
      const res = await this.dynamoClient.send(
        new GetCommand({ TableName: AGENT_STATE_TABLE, Key: { id: this.stateId(instance, phoneNumber) } }),
      );
      return (res.Item as AgentState) || null;
    } catch (err: any) {
      this.logger.error(
        `DynamoDB GetItem falló (tabla="${AGENT_STATE_TABLE}", region=${process.env.AWS_REGION || '?'}): ${err?.message || err}`,
      );
      throw err;
    }
  }

  async upsertState(
    instance: string,
    phoneNumber: string,
    instructorId: string,
    patch: Partial<Omit<AgentState, 'id' | 'instance' | 'phoneNumber' | 'instructorId'>>,
  ): Promise<AgentState> {
    const current = await this.getState(instance, phoneNumber);
    const next: AgentState = {
      id: this.stateId(instance, phoneNumber),
      instance,
      phoneNumber,
      instructorId,
      flujo: (patch.flujo ?? current?.flujo ?? 'conversacion') as ConversationFlow,
      courseId: 'courseId' in patch ? patch.courseId : current?.courseId,
      moduleId: 'moduleId' in patch ? patch.moduleId : current?.moduleId,
      lastQuestion: 'lastQuestion' in patch ? patch.lastQuestion : current?.lastQuestion,
      lastSessionAt: 'lastSessionAt' in patch ? patch.lastSessionAt : current?.lastSessionAt,
      offeredNextModuleId: 'offeredNextModuleId' in patch
        ? patch.offeredNextModuleId
        : current?.offeredNextModuleId,
      introShownForModuleId: 'introShownForModuleId' in patch
        ? patch.introShownForModuleId
        : current?.introShownForModuleId,
      awaitingPostAnswerAction: 'awaitingPostAnswerAction' in patch
        ? patch.awaitingPostAnswerAction
        : current?.awaitingPostAnswerAction,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.dynamoClient.send(new PutCommand({ TableName: AGENT_STATE_TABLE, Item: next }));
    } catch (err: any) {
      this.logger.error(
        `DynamoDB PutItem falló (tabla="${AGENT_STATE_TABLE}", region=${process.env.AWS_REGION || '?'}): ${err?.message || err}`,
      );
      throw err;
    }
    return next;
  }

  /**
   * Equivalente a n8n `get_session` + `If`/`If1`: sin sesion o inactivo mas de
   * `timeoutMinutes` → conversacion inicial (AI Agent1).
   */
  isSessionExpired(state: AgentState | null, timeoutMinutes: number): boolean {
    if (!state) return true;
    const anchor = state.lastSessionAt ?? state.updatedAt;
    if (!anchor) return true;
    const elapsedMs = Date.now() - new Date(anchor).getTime();
    return elapsedMs > timeoutMinutes * 60 * 1000;
  }

  // ===== Banco de preguntas =====

  async getQuestionBank(courseId: string, moduleId: string): Promise<ModuleQuestion[] | null> {
    for (const tableName of [COURSE_MODULE_QUESTIONS_TABLE, LEGACY_QUESTION_BANK_TABLE]) {
      const res = await this.dynamoClient.send(
        new GetCommand({ TableName: tableName, Key: { courseId, moduleId } }),
      );
      const parsed = this.parseQuestionBankItem(res.Item as CourseModuleQuestions | undefined);
      if (parsed) return parsed;
    }
    return null;
  }

  private parseQuestionBankItem(item?: CourseModuleQuestions): ModuleQuestion[] | null {
    if (!item?.questions) return null;
    try {
      const arr = typeof item.questions === 'string' ? JSON.parse(item.questions) : item.questions;
      return Array.isArray(arr) && arr.length > 0 ? arr : null;
    } catch {
      return null;
    }
  }

  async saveQuestionBank(courseId: string, moduleId: string, questions: ModuleQuestion[]): Promise<void> {
    const item: CourseModuleQuestions = {
      courseId,
      moduleId,
      questions: JSON.stringify(questions),
      updatedAt: new Date().toISOString(),
    };
    await this.dynamoClient.send(new PutCommand({ TableName: COURSE_MODULE_QUESTIONS_TABLE, Item: item }));
  }

  // ===== Avance de preguntas del estudiante (tabla Progress, formato n8n) =====

  async getQuestionNumber(phoneNumber: string, moduleId: string): Promise<number> {
    const item = await this.getProgressItem(phoneNumber, moduleId);
    if (!item) return 0;
    if (item.status != null) {
      return parseProgressStatus(item.status);
    }
    return parseProgressStatus(item.questionNumber);
  }

  async advanceQuestion(phoneNumber: string, moduleId: string, courseId?: string): Promise<number> {
    const item = await this.getProgressItem(phoneNumber, moduleId);
    const raw = item?.status ?? item?.questionNumber;
    const nextStatus = Number.isFinite(Number(raw)) ? Number(raw) + 1 : 1;
    await this.setProgressStatus(phoneNumber, moduleId, nextStatus, courseId);
    return nextStatus;
  }

  private async getProgressItem(
    phoneNumber: string,
    moduleId: string,
  ): Promise<StudentQuestionProgress | null> {
    const keys = [...new Set([progressPhoneKey(phoneNumber), phoneNumber.trim()])];
    for (const key of keys) {
      const res = await this.dynamoClient.send(
        new GetCommand({
          TableName: STUDENT_PROGRESS_TABLE,
          Key: { phoneNumber: key, moduleId },
        }),
      );
      if (res.Item) return res.Item as StudentQuestionProgress;
    }
    return null;
  }

  private async setProgressStatus(
    phoneNumber: string,
    moduleId: string,
    status: number,
    courseId?: string,
  ): Promise<void> {
    const key = progressPhoneKey(phoneNumber);
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: STUDENT_PROGRESS_TABLE,
        Key: { phoneNumber: key, moduleId },
        UpdateExpression: 'SET #status = :s, courseId = :c, updatedAt = :u',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':s': status,
          ':c': courseId ?? null,
          ':u': new Date().toISOString(),
        },
      }),
    );
  }
}
