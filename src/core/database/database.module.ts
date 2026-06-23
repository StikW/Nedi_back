import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDynamoDBClient } from '../config/database.config';

/**
 * Global module that provides the DynamoDB client
 */
@Global()
@Module({
  providers: [
    {
      provide: 'DYNAMODB_CLIENT',
      useFactory: (configService: ConfigService) => createDynamoDBClient(configService),
      inject: [ConfigService],
    },
  ],
  exports: ['DYNAMODB_CLIENT'],
})
export class DatabaseModule {}
