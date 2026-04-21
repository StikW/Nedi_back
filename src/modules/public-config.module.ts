import { Module } from '@nestjs/common';
import { PublicConfigController } from '../controllers/public-config.controller';

@Module({
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}

