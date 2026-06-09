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
  /**
   * User's phone number in E.164 format (e.g. +573001234567).
   * Solo aplica para instructores: se usa como número del "tutor NEDI" que se
   * inserta en la plantilla de WhatsApp `nedi_bienvenida_curso`.
   */
  phoneNumber?: string;
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

  // ===== Evolution API (numero de capacitacion del instructor) =====
  /** Nombre de la instancia de Evolution asignada al instructor (p.ej. nedi_<id>) */
  evolutionInstance?: string;
  /** API key de la instancia devuelta por Evolution al crearla */
  evolutionApiKey?: string;
  /** Numero de WhatsApp vinculado a la instancia (E.164 sin +) */
  evolutionNumber?: string;
  /** Estado de la conexion: disconnected | connecting | connected */
  evolutionStatus?: 'disconnected' | 'connecting' | 'connected';
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';
/**
 * DynamoDB table name for users
 */
export const USERS_TABLE = _tablePrefix + 'Users'; 