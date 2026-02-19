import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConfigService } from '@nestjs/config';

/**
 * Creates and configures the DynamoDB client
 * @returns Configured DynamoDB document client
 */
export const createDynamoDBClient = (configService: ConfigService): DynamoDBDocumentClient => {
  const client = new DynamoDBClient({
    region: configService.get<string>('AWS_REGION', 'us-east-1'),
    credentials: {
      accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
    },
  });

  return DynamoDBDocumentClient.from(client);
}; 