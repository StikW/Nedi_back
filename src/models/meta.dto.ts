import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { MetaContactStatus } from './meta-contact.entity';
import { MetaTemplateStatus } from './meta-template.entity';

export class CreateMetaContactDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ValidateIf((o) => o.email !== undefined && o.email !== null && o.email !== '')
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(['active', 'inactive'])
  @IsOptional()
  status?: MetaContactStatus;
}

export class UpdateMetaContactDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @ValidateIf((o) => o.email !== undefined && o.email !== null && o.email !== '')
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(['active', 'inactive'])
  @IsOptional()
  status?: MetaContactStatus;
}

export class CreateMetaTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsEnum(['approved', 'pending', 'rejected'])
  @IsOptional()
  status?: MetaTemplateStatus;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class UpdateMetaTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsEnum(['approved', 'pending', 'rejected'])
  @IsOptional()
  status?: MetaTemplateStatus;

  @IsString()
  @IsOptional()
  content?: string;
}

export class UpdateMetaApiConfigDto {
  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  @IsString()
  @IsOptional()
  businessAccountId?: string;

  @IsString()
  @IsOptional()
  accessToken?: string;

  @IsString()
  @IsOptional()
  appSecret?: string;

  @IsString()
  @IsOptional()
  verifyToken?: string;

  @IsString()
  @IsOptional()
  graphApiVersion?: string;
}

export class SendMetaMessageDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsOptional()
  variables?: Record<string, string>;
}
