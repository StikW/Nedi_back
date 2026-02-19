/**
 * Represents a course module in the system
 */
export interface CourseModule {
  /** Unique identifier for the module */
  id: string;
  /** Course ID this module belongs to */
  courseId: string;
  /** Module title */
  title: string;
  /** Module description */
  description: string;
  /** Module order within the course */
  order: number;
  /** Module content (URL to video, document, etc.) */
  content: string;
  /** Module status */
  status: ModuleStatus;
  /** Module resources (files, links, etc.) */
  resources?: ModuleResource[];
  /** When the module was created */
  createdAt: string;
  /** When the module was last updated */
  updatedAt: string;
}

/**
 * Module status options
 */
export enum ModuleStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived'
}

/**
 * Module resource structure
 */
export interface ModuleResource {
  /** Resource name */
  name: string;
  /** Resource URL or identifier */
  url: string;
  /** Resource size in bytes (for files) */
  size?: number;
}

/**
 * DynamoDB table name for course modules
 */
export const COURSE_MODULES_TABLE = 'CourseModules';

/**
 * DynamoDB table name for course module progress
 */
export const MODULE_PROGRESS_TABLE = 'ModuleProgress';
