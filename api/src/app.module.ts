import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loggerParams } from './common/logging.js';
import { appConfig, type AppConfig } from './config/app.config.js';
import { databaseOptions } from './database/database.options.js';
import { HealthModule } from './health/health.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { RequestsModule } from './requests/requests.module.js';

@Module({
  imports: [
    // .env is loaded by main.ts (Node's own loader); this validates and types the result.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig] }),
    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => loggerParams(config.LOG_LEVEL),
    }),
    TypeOrmModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        ...databaseOptions(config.DATABASE_URL),
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
