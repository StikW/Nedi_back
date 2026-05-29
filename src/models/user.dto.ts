import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional, ValidateIf, Matches } from 'class-validator';
import { UserRole } from './user.entity';

/**
 * Data transfer object for updating user information
 */
export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  public email?: string;

  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.password !== undefined && o.password !== null && o.password.trim() !== '')
  @MinLength(6)
  public password?: string;

  @IsString()
  @IsOptional()
  public name?: string;

  @IsEnum(UserRole)
  @IsOptional()
  public role?: UserRole;

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

  /** Client ID for app integration */
  @IsString()
  @IsOptional()
  public clientIdApp?: string;

  /** Client Secret for app integration */
  @IsString()
  @IsOptional()
  public clientSecretApp?: string;

  /** Business Account ID */
  @IsString()
  @IsOptional()
  public businessAccountId?: string;

  /** Access Token for external services */
  @IsString()
  @IsOptional()
  public accessToken?: string;

  /** API Key for external services */
  @IsString()
  @IsOptional()
  public apiKey?: string;
}

/**
 * Response DTO for user information (without password)
 */
export class UserResponseDto {
  /** Unique identifier for the user */
  public id!: string;
  /** User's email address */
  public email!: string;
  /** User's full name */
  public name!: string;
  /** User's role in the system */
  public role!: UserRole;
  /** Tel\u00e9fono del instructor (E.164). Solo expuesto para instructores/admin. */
  public phoneNumber?: string;
  /** When the user was created */
  public createdAt!: string;
  /** When the user was last updated */
  public updatedAt!: string;
  /** Client ID for app integration */
  public clientIdApp?: string;
  /** Client Secret for app integration */
  public clientSecretApp?: string;
  /** Business Account ID */
  public businessAccountId?: string;
  /** Access Token for external services */
  public accessToken?: string;
  /** API Key for external services */
  public apiKey?: string;
  /** Value for external services */
  public value?: string;
}
