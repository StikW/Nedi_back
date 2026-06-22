const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export type MetaMessageDirection = 'sent' | 'received';

export interface MetaMessage {
  id: string;
  /** Teléfono en E.164 (con +) usado como clave de conversación */
  phone: string;
  contactName?: string;
  direction: MetaMessageDirection;
  body: string;
  wamid?: string;
  templateName?: string;
  timestamp: string;
}

export const META_MESSAGES_TABLE = _tablePrefix + 'MetaMessages';
