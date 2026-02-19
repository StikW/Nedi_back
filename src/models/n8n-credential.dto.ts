import { IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

/**
 * DTO for creating n8n credentials
 */
export class CreateN8nCredentialDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsOptional()
  id_n8n?: string;

  // Campos específicos para whatsAppTriggerApi
  @ValidateIf(o => o.type === 'whatsAppTriggerApi')
  @IsString()
  @IsNotEmpty()
  clientId?: string;

  @ValidateIf(o => o.type === 'whatsAppTriggerApi')
  @IsString()
  @IsNotEmpty()
  clientSecret?: string;

  // Campos específicos para whatsAppApi
  @ValidateIf(o => o.type === 'whatsAppApi')
  @IsString()
  @IsNotEmpty()
  accessToken?: string;

  @ValidateIf(o => o.type === 'whatsAppApi')
  @IsString()
  @IsNotEmpty()
  businessAccountId?: string;

  @ValidateIf(o => o.type === 'openAiApi')
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  @ValidateIf(o => o.type === 'httpHeaderAuth')
  @IsString()
  @IsNotEmpty()
  value?: string;

}

/**
 * DTO for updating n8n credentials
 */
export class UpdateN8nCredentialDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  id_n8n?: string;

  // Campos específicos para whatsAppTriggerApi
  @ValidateIf(o => o.type === 'whatsAppTriggerApi')
  @IsString()
  @IsOptional()
  clientId?: string;

  @ValidateIf(o => o.type === 'whatsAppTriggerApi')
  @IsString()
  @IsOptional()
  clientSecret?: string;

  // Campos específicos para whatsAppApi
  @ValidateIf(o => o.type === 'whatsAppApi')
  @IsString()
  @IsOptional()
  accessToken?: string;

  @ValidateIf(o => o.type === 'whatsAppApi')
  @IsString()
  @IsOptional()
  businessAccountId?: string;

  @ValidateIf(o => o.type === 'httpHeaderAuth')
  @IsString()
  @IsOptional()
  value?: string;

  @ValidateIf(o => o.type === 'openAiApi')
  @IsString()
  @IsOptional()
  apiKey?: string;
}

/**
 * Response from n8n API when creating credentials
 */
export interface N8nCredentialResponse {
  id: string;
  name: string;
  type: string;
  data: any;
  createdAt: string;
  updatedAt: string;
}
