import { ConversationFlow } from '../services/agent/agent.types';

/**
 * Estado conversacional del agente por (instancia + telefono).
 * Reemplaza la DataTable `actual_course` de n8n.
 */
export interface AgentState {
  /** id compuesto: `${instance}#${phoneNumber}` */
  id: string;
  instance: string;
  phoneNumber: string;
  instructorId: string;
  /** Curso activo seleccionado por el estudiante */
  courseId?: string;
  /** Modulo activo en el flujo de preguntas */
  moduleId?: string;
  /** Estado del flujo: conversacion | preguntas */
  flujo: ConversationFlow;
  /** Texto de la ultima pregunta mostrada (para clasificar respuestas) */
  lastQuestion?: string;
  updatedAt: string;
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';
export const AGENT_STATE_TABLE = _tablePrefix + 'AgentState';
