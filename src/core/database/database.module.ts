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
      useFactory: (configService: ConfigService) => {
        console.log('Loading environment variables:');
        console.log('AWS_REGION:', configService.get('AWS_REGION'));
        console.log('AWS_ACCESS_KEY_ID:', configService.get('AWS_ACCESS_KEY_ID'));
        console.log('AWS_SECRET_ACCESS_KEY:', configService.get('AWS_SECRET_ACCESS_KEY'));
        console.log('S3_BUCKET:', configService.get('S3_BUCKET'));
        console.log('S3_BUCKET_MODULES:', configService.get('S3_BUCKET_MODULES'));
        console.log('N8N_BASE_URL:', configService.get('N8N_BASE_URL'));
        console.log('N8N_API_KEY:', configService.get('N8N_API_KEY') ? 'SET' : 'NOT SET');
        return createDynamoDBClient(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['DYNAMODB_CLIENT'],
})
export class DatabaseModule {} 