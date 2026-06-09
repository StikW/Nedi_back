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
/**
 * Reutiliza la tabla existente `CourseModuleProgress` (clave courseId+moduleId)
 * como banco de preguntas, evitando crear tablas nuevas.
 */
export const COURSE_MODULE_QUESTIONS_TABLE = _tablePrefix + 'CourseModuleProgress';

/**
 * Avance del estudiante por modulo (numero de pregunta actual). Equivale a la
 * tabla `Progress` de n8n (clave: phoneNumber + moduleId).
 */
export interface StudentQuestionProgress {
  phoneNumber: string;
  moduleId: string;
  courseId?: string;
  /** indice 0-based de la pregunta actual */
  questionNumber: number;
  updatedAt?: string;
}

export const STUDENT_PROGRESS_TABLE = _tablePrefix + 'Progress';
