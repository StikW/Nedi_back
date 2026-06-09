/**
 * Banco de preguntas por curso/modulo. Lo genera el agente generador y lo
 * consume el agente de preguntas. Equivale a la tabla `CourseModuleQuestions`
 * usada por los sub-workflows de n8n (clave: courseId + moduleId).
 */
export interface ModuleQuestion {
  pregunta: string;
  tipo: 'opcion_multiple' | 'verdadero_falso' | 'completar' | 'relacionar' | string;
  opciones?: string[];
  respuesta_correcta: string | number | string[];
}

export interface CourseModuleQuestions {
  courseId: string;
  moduleId: string;
  /** JSON.stringify(ModuleQuestion[]) — formato identico al de n8n */
  questions: string;
  updatedAt?: string;
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

/** Tabla oficial de n8n (WF_ObtenerPreguntas / WF_GeneradorPreguntas). */
export const COURSE_MODULE_QUESTIONS_TABLE = _tablePrefix + 'CourseModuleQuestions';

/** Tabla legacy del primer intento de migracion; solo lectura como fallback. */
export const LEGACY_QUESTION_BANK_TABLE = _tablePrefix + 'CourseModuleProgress';

/**
 * Avance del estudiante por modulo. Equivale a la tabla `Progress` de n8n
 * (clave: phoneNumber + moduleId). n8n usa prefijo `wa` en phoneNumber y campo `status`.
 */
export interface StudentQuestionProgress {
  phoneNumber: string;
  moduleId: string;
  courseId?: string;
  /** Indice 0-based de la pregunta actual (campo de n8n). */
  status?: number;
  /** Campo legacy del backend previo a esta alineacion. */
  questionNumber?: number;
  updatedAt?: string;
}

export const STUDENT_PROGRESS_TABLE = _tablePrefix + 'Progress';

/** Clave phoneNumber en Progress, igual que n8n (`wa` + E.164 sin +). */
export function progressPhoneKey(phoneNumber: string): string {
  const p = phoneNumber.trim();
  return p.startsWith('wa') ? p : `wa${p}`;
}

/**
 * Convierte `status` de Progress al indice del banco (logica de WF_ObtenerPreguntas).
 */
export function parseProgressStatus(status: unknown): number {
  if (status == null || status === '') return 0;
  if (typeof status === 'number' && !Number.isNaN(status)) return status;
  const n = Number(status);
  if (!Number.isNaN(n)) return n;
  const m = String(status).match(/pregunta\s*(\d+)/i);
  if (m) return Math.max(0, parseInt(m[1], 10) - 1);
  return 0;
}
