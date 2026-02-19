/**
 * Represents a course in the system
 */
export interface Course {
  /** Unique identifier for the course */
  id: string;
  /** Course title */
  title: string;
  /** Course description */
  description: string;
  /** Course category */
  category: CourseCategory;
  /** URL to course image */
  imageUrl: string;
  /** Course learning objectives */
  objectives: string;
  /** Course prerequisites */
  prerequisites?: string;
  /** Course status */
  status: CourseStatus;
  /** Course instructor ID */
  instructorId: string;
  /** When the course was created */
  createdAt: string;
  /** When the course was last updated */
  updatedAt: string;
}

/**
 * Course status options
 */
export enum CourseStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/**
 * Available course categories
 */
export const COURSE_CATEGORIES = [
  'programming',
  'design',
  'business',
  'marketing',
  'music',
  'photography',
  'language',
  'other',
] as const;

export type CourseCategory = typeof COURSE_CATEGORIES[number];

/**
 * DynamoDB table name for courses
 */
export const COURSES_TABLE = 'Courses'; 