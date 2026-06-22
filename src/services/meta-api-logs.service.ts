import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { MetaApiLog, META_API_LOGS_TABLE } from '../models/meta-api-log.entity';

@Injectable()
export class MetaApiLogsService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async create(log: Omit<MetaApiLog, 'id' | 'timestamp'> & { timestamp?: string }): Promise<MetaApiLog> {
    const entry: MetaApiLog = {
      id: uuidv4(),
      timestamp: log.timestamp || new Date().toISOString(),
      method: log.method,
      endpoint: log.endpoint,
      status: log.status,
      request: log.request,
      response: log.response,
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_API_LOGS_TABLE, Item: entry }),
    );
    return entry;
  }

  async findAll(limit = 100): Promise<MetaApiLog[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({ TableName: META_API_LOGS_TABLE, Limit: limit }),
    );
    const items = (result.Items as MetaApiLog[]) || [];
    return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async countSince(isoDate: string): Promise<number> {
    const logs = await this.findAll(500);
    return logs.filter((l) => l.timestamp >= isoDate).length;
  }
}
