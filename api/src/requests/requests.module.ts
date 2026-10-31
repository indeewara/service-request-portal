import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { ServiceRequest } from './service-request.entity.js';
import { StatusHistory } from './status-history.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRequest, StatusHistory]),
    AuthModule,
    OrdersModule,
    NotificationsModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
  // Attachments use findAccessible() for their ownership check.
  exports: [RequestsService],
})
export class RequestsModule {}
