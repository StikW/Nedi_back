import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UploadsController } from '../controllers/uploads.controller';
import { UploadsService } from '../services/uploads.service';
import { CoursesModule } from './courses.module';

@Module({
  imports: [ConfigModule, forwardRef(() => CoursesModule)],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
