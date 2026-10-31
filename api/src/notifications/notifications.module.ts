import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { Notification } from './notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsWorker } from './notifications.worker.js';
import { RequestEventsService } from './request-events.service.js';

// ponytail: worker runs inside the API process; move it to its own container (same image) when email volume competes with API traffic.
@Module({
  imports: [TypeOrmModule.forFeature([Notification]), AuthModule],
  providers: [NotificationsService, NotificationsWorker, MockEmailProvider, RequestEventsService],
  exports: [NotificationsService, RequestEventsService],
})
export class NotificationsModule {}
