/**
 * Represents a completed module by a student
 */
export interface ModuleProgress {
  /** Composite key: phoneNumber#moduleId */
  id: string;
  /** Student phone number */
  phoneNumber: string;
  /** Module ID */
  moduleId: string;
  /** Course ID */
  courseId: string;
  /** Time spent on module in minutes */
  timeSpentMinutes: number;
  /** When the module was completed */
  completedAt: string;
}

/**
 * DynamoDB table name for module progress
 */
export const MODULE_PROGRESS_TABLE = 'ModuleProgress';
