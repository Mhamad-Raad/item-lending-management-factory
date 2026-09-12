import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [UploadsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
