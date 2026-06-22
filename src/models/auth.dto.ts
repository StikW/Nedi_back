import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional, ValidateIf, Matches, IsBoolean } from 'class-validator';
import { UserRole } from './user.entity';

/**
 * Data transfer object for user registration
 */
export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  public email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  public password!: string;

  @IsString()
  @IsNotEmpty()
  public name!: string;

  @IsEnum(UserRole)
  @IsOptional()
  public role?: UserRole;

  /** Account active status (Meta users and others). Defaults to true. */
  @IsBoolean()
  @IsOptional()
  public isActive?: boolean;

  /**
   * Tel\u00e9fono del instructor en formato E.164 (con o sin "+").
   * Se usa como n\u00famero del tutor en la plantilla de bienvenida de WhatsApp.
   */
  @IsString()
  @IsOptional()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'phoneNumber debe estar en formato E.164 (ej: +573001234567)',
  })
  public phoneNumber?: string;

  // Campos específicos para instructores (WhatsApp credentials)
  @ValidateIf(o => o.role === UserRole.INSTRUCTOR)
  @IsString()
  @IsNotEmpty()
  public clientIdApp?: string;

  @ValidateIf(o => o.role === UserRole.INSTRUCTOR)
  @IsString()
  @IsNotEmpty()
  public clientSecretApp?: string;

  @ValidateIf(o => o.role === UserRole.INSTRUCTOR)
  @IsString()
  @IsNotEmpty()
  public accessToken?: string;

  @ValidateIf(o => o.role === UserRole.INSTRUCTOR)
  @IsString()
  @IsNotEmpty()
  public businessAccountId?: string;

  @ValidateIf(o => o.role === UserRole.INSTRUCTOR)
  @IsString()
  @IsNotEmpty()
  public apiKey?: string;
}

/**
 * Data transfer object for user login
 */
export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  public email!: string;

  @IsString()
  @IsNotEmpty()
  public password!: string;
}

/**
 * Data transfer object for changing password
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  public currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  public newPassword!: string;
}

/**
 * Response DTO for authentication operations
 */
export class AuthResponseDto {
  /** JWT access token */
  public token!: string;
  /** User information */
  public id!: string;
  public email!: string;
  public name!: string;
  public role!: UserRole;
} 