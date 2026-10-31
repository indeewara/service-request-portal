import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { correlationId } from './common/correlation-id.js';
import { appConfig, type AppConfig } from './config/app.config.js';

/** App-wide wiring shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication) {
  // Number of proxies in front of the API (Next.js server, ALB). Express then takes the
  // client IP from X-Forwarded-For, so the login limit counts per user, not per proxy.
  // Only as many hops as really exist: more would let clients spoof their IP.
  (app as NestExpressApplication).set(
    'trust proxy',
    app.get<AppConfig>(appConfig.KEY).TRUST_PROXY_HOPS,
  );
  app.useLogger(app.get(Logger));
  app.use(correlationId);
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Service Request Portal API')
    .setDescription(
      'Errors always use `{ statusCode, error, message, details?, correlationId }`. ' +
        'Send `x-correlation-id` to trace a call; the API echoes it or creates one.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
