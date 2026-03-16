import { Injectable, Inject } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

@Injectable()
export class TokenBlacklistService {
  private readonly BLACKLIST_TABLE = _tablePrefix + 'TokenBlacklist';

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async addToBlacklist(token: string, expiresAt: number): Promise<void> {
    console.log('Adding token to blacklist');
    try {
      await this.dynamoClient.send(new PutCommand({
        TableName: this.BLACKLIST_TABLE,
        Item: {
          token,
          expiresAt,
          createdAt: new Date().toISOString()
        }
      }));
      console.log('Token added to blacklist successfully');
    } catch (error) {
      console.error('Error adding token to blacklist:', error);
      throw error;
    }
  }

  async isBlacklisted(token: string): Promise<boolean> {
    console.log('Checking if token is blacklisted');
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.BLACKLIST_TABLE,
        Key: { token }
      }));

      if (!result.Item) {
        console.log('Token not found in blacklist');
        return false;
      }

      // Si el token ha expirado, lo eliminamos de la lista negra
      if (result.Item.expiresAt < Date.now()) {
        console.log('Token has expired, removing from blacklist');
        await this.dynamoClient.send(new DeleteCommand({
          TableName: this.BLACKLIST_TABLE,
          Key: { token }
        }));
        return false;
      }

      console.log('Token found in blacklist');
      return true;
    } catch (error) {
      console.error('Error checking token blacklist:', error);
      throw error;
    }
  }
} 