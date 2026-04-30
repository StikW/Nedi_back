/**
 * Represents a student in the system
 */
export interface Student {
  /** Unique identifier for the student */
  id: string;
  /** Student name */
  name: string;
  /** Student phone number */
  phoneNumber: string;
  /** Course ID this student belongs to */
  courseId: string;
  /** Instructor ID who enrolled this student */
  instructorId: string;
  /** When the student was enrolled */
  enrolledAt: string;
  /** When the student record was last updated */
  updatedAt: string;
  /** Número de veces que el estudiante ha ingresado al sistema */
  loginCount?: number;
  /**
   * Fecha ISO de la \u00faltima vez que se le envi\u00f3 un recordatorio por WhatsApp.
   * @deprecated Mantener por compatibilidad. Usar `lastDailyReminderSentAt`.
   */
  lastReminderSentAt?: string;
  /** Fecha ISO de la \u00faltima vez que se envi\u00f3 la plantilla `nedi_bienvenida_curso` */
  lastWelcomeSentAt?: string;
  /** Fecha ISO de la \u00faltima vez que se envi\u00f3 la plantilla `nedi_recordatorio_diario` */
  lastDailyReminderSentAt?: string;
  /** Fecha ISO de la \u00faltima vez que se envi\u00f3 la plantilla `nedi_reflexion_semanal` */
  lastWeeklyReflectionSentAt?: string;
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';
/**
 * DynamoDB table name for students
 */
export const STUDENTS_TABLE = _tablePrefix + 'Students';
