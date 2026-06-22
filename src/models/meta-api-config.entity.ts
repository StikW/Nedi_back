const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

/** Singleton config record for WhatsApp Business Cloud API credentials. */
export interface MetaApiConfig {
  id: 'GLOBAL';
  phoneNumberId?: string;
  businessAccountId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  graphApiVersion?: string;
  updatedAt: string;
}

export const META_API_CONFIG_TABLE = _tablePrefix + 'MetaApiConfig';
