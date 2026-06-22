import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { MetaApiConfig, META_API_CONFIG_TABLE } from '../models/meta-api-config.entity';
import { UpdateMetaApiConfigDto } from '../models/meta.dto';

const CONFIG_ID = 'GLOBAL';

@Injectable()
export class MetaApiConfigService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  /** Returns config with sensitive fields masked for display. */
  async getConfig(): Promise<MetaApiConfig> {
    const result = await this.dynamoClient.send(
      new GetCommand({ TableName: META_API_CONFIG_TABLE, Key: { id: CONFIG_ID } }),
    );

    if (!result.Item) {
      return { id: CONFIG_ID, updatedAt: new Date().toISOString() };
    }

    return result.Item as MetaApiConfig;
  }

  async updateConfig(dto: UpdateMetaApiConfigDto): Promise<MetaApiConfig> {
    const existing = await this.getConfig();
    const updated: MetaApiConfig = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined && v !== ''),
      ),
      id: CONFIG_ID,
      updatedAt: new Date().toISOString(),
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_API_CONFIG_TABLE, Item: updated }),
    );

    return updated;
  }
}
