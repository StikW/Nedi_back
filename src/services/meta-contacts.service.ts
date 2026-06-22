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
import { MetaContact, META_CONTACTS_TABLE } from '../models/meta-contact.entity';
import { CreateMetaContactDto, UpdateMetaContactDto } from '../models/meta.dto';

@Injectable()
export class MetaContactsService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async findAll(): Promise<MetaContact[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({ TableName: META_CONTACTS_TABLE }),
    );
    return (result.Items as MetaContact[]) || [];
  }

  async findById(id: string): Promise<MetaContact> {
    const result = await this.dynamoClient.send(
      new GetCommand({ TableName: META_CONTACTS_TABLE, Key: { id } }),
    );
    if (!result.Item) {
      throw new NotFoundException('Contacto no encontrado');
    }
    return result.Item as MetaContact;
  }

  async create(dto: CreateMetaContactDto): Promise<MetaContact> {
    const now = new Date().toISOString();
    const contact: MetaContact = {
      id: uuidv4(),
      name: dto.name,
      company: dto.company,
      phone: dto.phone,
      email: dto.email,
      status: dto.status || 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamoClient.send(
      new PutCommand({ TableName: META_CONTACTS_TABLE, Item: contact }),
    );
    return contact;
  }

  async update(id: string, dto: UpdateMetaContactDto): Promise<MetaContact> {
    await this.findById(id);

    const updateExpression: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const allowedFields: (keyof UpdateMetaContactDto)[] = [
      'name',
      'company',
      'phone',
      'email',
      'status',
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
        TableName: META_CONTACTS_TABLE,
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
      new DeleteCommand({ TableName: META_CONTACTS_TABLE, Key: { id } }),
    );
  }
}
