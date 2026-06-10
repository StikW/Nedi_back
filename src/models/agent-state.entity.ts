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
  /**
   * Ultima actividad del estudiante (equivalente a Redis `get_session` en n8n).
   * Si supera AGENT_SESSION_TIMEOUT_MINUTES sin mensajes, se dispara conversacion inicial.
   */
  lastSessionAt?: string;
  /** Siguiente modulo ofrecido tras completar el actual; se limpia al entrar a ese modulo. */
  offeredNextModuleId?: string;
  /**
   * @deprecated Ya no gobierna el intro; el video en pregunta 1 depende del índice
   * en Progress (0). Se limpia al expirar sesión o completar módulo.
   */
  introShownForModuleId?: string;
  /**
   * Tras validar una respuesta, el estudiante elige explicacion o siguiente pregunta.
   * Evita que "1"/"2" o "siguiente" se interpreten como respuesta a la pregunta anterior.
   */
  awaitingPostAnswerAction?: boolean;
  /**
   * Tras enviar el video intro del modulo, espera confirmacion del estudiante
   * antes de mandar el audio-resumen y la primera pregunta.
   */
  awaitingModuleStartConfirmation?: boolean;
  /**
   * True tras el mensaje de bienvenida (conversacion inicial). Evita que otros
   * agentes vuelvan a presentarse como Nedi en la misma sesion activa.
   */
  nediIntroShown?: boolean;
  updatedAt: string;
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';
export const AGENT_STATE_TABLE = _tablePrefix + 'AgentState';
