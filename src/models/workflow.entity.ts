/**
 * Represents a n8n workflow in the system
 */
export interface Workflow {
  /** Unique identifier for the workflow */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow description */
  description?: string;
  /** n8n workflow definition (JSON) */
  definition: any;
  /** Workflow status */
  status: WorkflowStatus;
  /** Workflow tags for categorization */
  tags?: string[];
  /** Workflow owner ID */
  ownerId: string;
  /** Whether the workflow is active in n8n */
  active: boolean;
  /** n8n workflow ID (external reference from n8n server) */
  n8nWorkflowId?: string;
  /** When the workflow was created */
  createdAt: string;
  /** When the workflow was last updated */
  updatedAt: string;
}

/**
 * Workflow status options
 */
export enum WorkflowStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';
/**
 * DynamoDB table name for workflows
 */
export const WORKFLOWS_TABLE = _tablePrefix + 'Workflows';
