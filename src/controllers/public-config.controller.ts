import { Controller, Get } from '@nestjs/common';
import { UploadsService } from '../services/uploads.service';

@Controller('config')
export class PublicConfigController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Expone al frontend las URLs publicas de S3 construidas desde .env:
   * S3_BUCKET, S3_BUCKET_MODULES y AWS_REGION.
   */
  @Get('public')
  public getPublicConfig(): {
    s3ResourcesPublicBaseUrl: string;
    s3ModulesPublicBaseUrl: string;
  } {
    return {
      s3ResourcesPublicBaseUrl: this.uploadsService.getResourcesPublicBaseUrl(),
      s3ModulesPublicBaseUrl: this.uploadsService.getModulesPublicBaseUrl(),
    };
  }
}
