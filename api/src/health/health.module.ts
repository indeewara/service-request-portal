import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [AttachmentsModule, NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
