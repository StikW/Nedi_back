import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { MetaTemplate, META_TEMPLATES_TABLE } from '../models/meta-template.entity';
import { CreateMetaTemplateDto, UpdateMetaTemplateDto } from '../models/meta.dto';

@Injectable()
export class MetaTemplatesService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async findAll(): Promise<MetaTemplate[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({ TableName: META_TEMPLATES_TABLE }),
    );
    return (result.Items as MetaTemplate[]) || [];
  }

  async findById(id: string): Promise<MetaTemplate> {
    const result = await this.dynamoClient.send(
      new GetCommand({ TableName: META_TEMPLATES_TABLE, Key: { id } }),
    );
    if (!result.Item) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return result.Item as MetaTemplate;
  }

  async create(dto: CreateMetaTemplateDto): Promise<MetaTemplate> {
    const now = new Date().toISOString();
    const template: MetaTemplate = {
      id: uuidv4(),
      name: dto.name,
      category: dto.category,
      language: dto.language,
      status: dto.status || 'pending',
      content: dto.content,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_TEMPLATES_TABLE, Item: template }),
    );
    return template;
  }

  async update(id: string, dto: UpdateMetaTemplateDto): Promise<MetaTemplate> {
    await this.findById(id);

    const updateExpression: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const allowedFields: (keyof UpdateMetaTemplateDto)[] = [
      'name',
      'category',
      'language',
      'status',
      'content',
    ];

    for (const key of allowedFields) {
      const value = dto[key];
      if (value === undefined) continue;
      updateExpression.push(`#${key} = :${key}`);
      names[`#${key}`] = key;
      values[`:${key}`] = value;
    }

    if (updateExpression.length === 0) {
      return this.findById(id);
    }

    updateExpression.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = new Date().toISOString();

    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: META_TEMPLATES_TABLE,
        Key: { id },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.dynamoClient.send(
      new DeleteCommand({ TableName: META_TEMPLATES_TABLE, Key: { id } }),
    );
  }
}
