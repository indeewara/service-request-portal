import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { appConfig, type AppConfig } from './config/app.config.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on real environment variables (e.g. from Docker).
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.listen(app.get<AppConfig>(appConfig.KEY).PORT);
}
await bootstrap();
