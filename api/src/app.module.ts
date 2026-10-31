import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loggerParams } from './common/logging.js';
import { databaseOptions } from './database/database.options.js';
import { HealthModule } from './health/health.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { RequestsModule } from './requests/requests.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams()),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseOptions(),
        autoLoadEntities: true,
        migrationsRun: true,
      }),
    }),
    AuthModule,
    OrdersModule,
    RequestsModule,
    AttachmentsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        // One message per invalid field, not every rule it breaks.
        stopAtFirstError: true,
      }),
    },
  ],
})
export class AppModule {}
