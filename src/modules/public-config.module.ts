import { Module } from '@nestjs/common';
import { UploadsModule } from './uploads.module';
import { PublicConfigController } from '../controllers/public-config.controller';

@Module({
  imports: [UploadsModule],
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}
