import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateNotificationConfigDto {
  @IsOptional()
  @IsString()
  whatsappApiVersion?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  whatsappBusinessAccountId?: string;

  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @IsOptional()
  @IsString()
  welcomeTemplateName?: string;

  @IsOptional()
  @IsString()
  welcomeTemplateLanguage?: string;

  @IsOptional()
  @IsString()
  welcomeTemplateBodyParams?: string;

  @IsOptional()
  @IsString()
  dailyTemplateName?: string;

  @IsOptional()
  @IsString()
  dailyTemplateLanguage?: string;

  @IsOptional()
  @IsString()
  dailyTemplateBodyParams?: string;

  @IsOptional()
  @IsArray()
  dailySendDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  dailySendHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  dailySendMinute?: number;

  @IsOptional()
  @IsString()
  weeklyTemplateName?: string;

  @IsOptional()
  @IsString()
  weeklyTemplateLanguage?: string;

  @IsOptional()
  @IsString()
  weeklyTemplateBodyParams?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weeklySendDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  weeklySendHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  weeklySendMinute?: number;

  @IsOptional()
  @IsString()
  reminderCronTimezone?: string;

  @IsOptional()
  @IsString()
  defaultTemplateName?: string;

  @IsOptional()
  @IsString()
  defaultTemplateLanguage?: string;

  @IsOptional()
  @IsString()
  defaultTemplateBodyParams?: string;
}
