import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional, ValidateIf } from 'class-validator';
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