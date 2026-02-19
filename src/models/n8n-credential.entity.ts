/**
 * Represents an n8n credential in the system
 */
export interface N8nCredential {
  /** Unique identifier for the credential */
  id: string;
  /** Name of the credential */
  name: string;
  /** Type of credential (e.g., whatsAppTriggerApi, whatsAppApi, etc.) */
  type: string;
  /** n8n credential ID */
  id_n8n: string;
  /** Instructor ID who owns this credential */
  instructorId: string;
  /** When the credential was created */
  createdAt: string;
  /** When the credential was last updated */
  updatedAt: string;
  
  // Campos específicos para whatsAppTriggerApi
  /** Client ID for WhatsApp Trigger API */
  clientId?: string;
  /** Client Secret for WhatsApp Trigger API */
  clientSecret?: string;
  
  // Campos específicos para whatsAppApi
  /** Access Token for WhatsApp API */
  accessToken?: string;
  /** Business Account ID for WhatsApp API */
  businessAccountId?: string;
  
  // Campos específicos para openAiApi
  /** API Key for OpenAI */
  apiKey?: string;
  
  // Campos específicos para httpHeaderAuth
  /** Header value for HTTP Bearer Auth */
  value?: string;
}

/**
 * DynamoDB table name for n8n credentials
 */
export const N8N_CREDENTIALS_TABLE = 'Credentials';
