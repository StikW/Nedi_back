import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('config')
export class PublicConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('public')
  public getPublicConfig(): {
    s3ResourcesPublicBaseUrl: string;
    s3ModulesPublicBaseUrl: string;
  } {
    const resourcesBucket = this.configService.get<string>('S3_BUCKET') || '';
    const modulesBucket = this.configService.get<string>('S3_BUCKET_MODULES') || '';

    return {
      s3ResourcesPublicBaseUrl: resourcesBucket ? `https://${resourcesBucket}.s3.amazonaws.com` : '',
      s3ModulesPublicBaseUrl: modulesBucket ? `https://${modulesBucket}.s3.amazonaws.com` : '',
    };
  }
}

