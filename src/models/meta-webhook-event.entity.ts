const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export interface MetaWebhookEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export const META_WEBHOOK_EVENTS_TABLE = _tablePrefix + 'MetaWebhookEvents';
