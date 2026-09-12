import { Module } from '@nestjs/common';
import { UploadIntakeInterceptor } from './upload-intake.interceptor';
import { UploadThrottleGuard } from './upload-throttle.guard';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadThrottleGuard, UploadIntakeInterceptor],
  // Settings (and items in M2) check that an upload id is of the kind they expect.
  exports: [UploadsService],
})
export class UploadsModule {}
