import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { MetaMessage, META_MESSAGES_TABLE } from '../models/meta-message.entity';

@Injectable()
export class MetaMessagesService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async create(data: Omit<MetaMessage, 'id' | 'timestamp'> & { timestamp?: string }): Promise<MetaMessage> {
    const message: MetaMessage = {
      id: uuidv4(),
      timestamp: data.timestamp || new Date().toISOString(),
      phone: data.phone,
      contactName: data.contactName,
      direction: data.direction,
      body: data.body,
      wamid: data.wamid,
      templateName: data.templateName,
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_MESSAGES_TABLE, Item: message }),
    );
    return message;
  }

  async findAll(): Promise<MetaMessage[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({ TableName: META_MESSAGES_TABLE }),
    );
    const items = (result.Items as MetaMessage[]) || [];
    return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async findByPhone(phone: string): Promise<MetaMessage[]> {
    const normalized = this.normalizePhone(phone);
    const all = await this.findAll();
    return all.filter((m) => this.normalizePhone(m.phone) === normalized);
  }

  async countSentToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    const all = await this.findAll();
    return all.filter((m) => m.direction === 'sent' && m.timestamp >= since).length;
  }

  async countReceivedToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = startOfDay.toISOString();
    const all = await this.findAll();
    return all.filter((m) => m.direction === 'received' && m.timestamp >= since).length;
  }

  async countActiveConversations(days = 7): Promise<number> {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const all = await this.findAll();
    const phones = new Set(
      all.filter((m) => m.timestamp >= since).map((m) => this.normalizePhone(m.phone)),
    );
    return phones.size;
  }

  normalizePhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits ? `+${digits}` : phone;
  }
}
