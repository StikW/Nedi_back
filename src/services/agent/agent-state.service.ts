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
  ModuleQuestion,
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
    const res = await this.dynamoClient.send(
      new GetCommand({ TableName: AGENT_STATE_TABLE, Key: { id: this.stateId(instance, phoneNumber) } }),
    );
    return (res.Item as AgentState) || null;
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
      courseId: patch.courseId ?? current?.courseId,
      moduleId: patch.moduleId ?? current?.moduleId,
      lastQuestion: patch.lastQuestion ?? current?.lastQuestion,
      updatedAt: new Date().toISOString(),
    };
    await this.dynamoClient.send(new PutCommand({ TableName: AGENT_STATE_TABLE, Item: next }));
    return next;
  }

  // ===== Banco de preguntas =====

  async getQuestionBank(courseId: string, moduleId: string): Promise<ModuleQuestion[] | null> {
    const res = await this.dynamoClient.send(
      new GetCommand({ TableName: COURSE_MODULE_QUESTIONS_TABLE, Key: { courseId, moduleId } }),
    );
    const item = res.Item as CourseModuleQuestions | undefined;
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

  // ===== Avance de preguntas del estudiante =====

  async getQuestionNumber(phoneNumber: string, moduleId: string): Promise<number> {
    const res = await this.dynamoClient.send(
      new GetCommand({ TableName: STUDENT_PROGRESS_TABLE, Key: { phoneNumber, moduleId } }),
    );
    const item = res.Item as StudentQuestionProgress | undefined;
    const n = item?.questionNumber;
    return typeof n === 'number' && !Number.isNaN(n) ? n : 0;
  }

  async setQuestionNumber(
    phoneNumber: string,
    moduleId: string,
    questionNumber: number,
    courseId?: string,
  ): Promise<void> {
    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: STUDENT_PROGRESS_TABLE,
        Key: { phoneNumber, moduleId },
        UpdateExpression: 'SET questionNumber = :n, courseId = :c, updatedAt = :u',
        ExpressionAttributeValues: {
          ':n': questionNumber,
          ':c': courseId ?? null,
          ':u': new Date().toISOString(),
        },
      }),
    );
  }

  async advanceQuestion(phoneNumber: string, moduleId: string, courseId?: string): Promise<number> {
    const current = await this.getQuestionNumber(phoneNumber, moduleId);
    const next = current + 1;
    await this.setQuestionNumber(phoneNumber, moduleId, next, courseId);
    return next;
  }
}
