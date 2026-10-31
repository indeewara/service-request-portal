import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on real environment variables (e.g. from Docker).
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
