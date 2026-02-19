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
}

/**
 * DynamoDB table name for students
 */
export const STUDENTS_TABLE = 'Students';
