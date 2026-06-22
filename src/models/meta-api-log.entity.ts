const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export interface MetaApiLog {
  id: string;
  method: string;
  endpoint: string;
  status: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  timestamp: string;
}

export const META_API_LOGS_TABLE = _tablePrefix + 'MetaApiLogs';
