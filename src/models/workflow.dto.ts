import { IsString, IsEnum, IsArray, IsBoolean, IsOptional, IsObject, MinLength, MaxLength } from 'class-validator';
import { WorkflowStatus } from './workflow.entity';

/**
 * Data transfer object for creating a new workflow in n8n
 */
export class CreateWorkflowDto {
  /** Workflow name (3-100 characters) */
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  /** Workflow description (optional) */
  @IsOptional()
  @IsString()
  description?: string;

  /** n8n workflow definition (JSON object) */
  @IsObject()
  definition!: any;

  /** Workflow tags for categorization */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  /** Whether the workflow should be active in n8n */
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  /** Credentials for the workflow template */
  @IsObject()
  @IsOptional()
  credentials?: {
    whatsAppTriggerApiId: string;
    whatsAppTriggerApiName: string;
    openAiApiId: string;
    openAiApiName: string;
    httpBearerAuthId: string;
    httpBearerAuthName: string;
    whatsAppApiId: string;
    whatsAppApiName: string;
  };
}

/**
 * Data transfer object for updating an existing workflow
 */
export class UpdateWorkflowDto {
  /** Workflow name (3-100 characters) */
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @IsOptional()
  name?: string;

  /** Workflow description */
  @IsOptional()
  @IsString()
  description?: string;

  /** n8n workflow definition (JSON object) */
  @IsObject()
  @IsOptional()
  definition?: any;

  /** Workflow tags for categorization */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  /** Whether the workflow should be active in n8n */
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

/**
 * Response from n8n API when creating/updating a workflow
 */
export class N8nWorkflowResponse {
  /** n8n workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow definition */
  definition: any;
  /** Whether workflow is active */
  active: boolean;
  /** Creation timestamp */
  createdAt: string;
  /** Update timestamp */
  updatedAt: string;
}

/**
 * Response from n8n API when executing a workflow
 */
export class N8nExecutionResponse {
  /** Execution ID */
  id: string;
  /** Workflow ID */
  workflowId: string;
  /** Execution status */
  status: 'running' | 'success' | 'error' | 'waiting';
  /** Execution result data */
  data?: any;
  /** Error message if execution failed */
  error?: string;
  /** Execution start time */
  startedAt: string;
  /** Execution end time */
  finishedAt?: string;
}
