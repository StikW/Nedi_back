import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { MetaWebhookEvent, META_WEBHOOK_EVENTS_TABLE } from '../models/meta-webhook-event.entity';

@Injectable()
export class MetaWebhookEventsService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async create(type: string, payload: Record<string, unknown>): Promise<MetaWebhookEvent> {
    const event: MetaWebhookEvent = {
      id: uuidv4(),
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_WEBHOOK_EVENTS_TABLE, Item: event }),
    );
    return event;
  }

  async findAll(limit = 100): Promise<MetaWebhookEvent[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({ TableName: META_WEBHOOK_EVENTS_TABLE, Limit: limit }),
    );
    const items = (result.Items as MetaWebhookEvent[]) || [];
    return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async hasRecentEvent(withinHours = 24): Promise<boolean> {
    const since = new Date(Date.now() - withinHours * 3600000).toISOString();
    const events = await this.findAll(50);
    return events.some((e) => e.timestamp >= since);
  }
}
