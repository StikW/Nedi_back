/**
 * User roles available in the system
 */
export enum UserRole {
  ADMIN = 'admin',
  INSTRUCTOR = 'instructor',
  STUDENT = 'student'
}

/**
 * Represents a user in the system
 */
export interface User {
  /** Unique identifier for the user */
  id: string;
  /** User's email address */
  email: string;
  /** User's hashed password */
  password: string;
  /** User's full name */
  name: string;
  /** User's role in the system */
  role: UserRole;
  /** When the user was created */
  createdAt: string;
  /** When the user was last updated */
  updatedAt: string;
  /** Client ID for app integration */
  clientIdApp?: string;
  /** Client Secret for app integration */
  clientSecretApp?: string;
  /** Business Account ID */
  businessAccountId?: string;
  /** Access Token for external services */
  accessToken?: string;
  /** API Key for external services */
  apiKey?: string;
}

/**
 * DynamoDB table name for users
 */
export const USERS_TABLE = 'Users'; 