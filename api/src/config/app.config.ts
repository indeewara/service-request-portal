import { ConfigType, registerAs } from '@nestjs/config';
import { Expose, plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/** Every setting the API reads, with its default. The only place that touches process.env. */
class Env {
  @Expose() @Type(() => Number) @IsInt() @Min(1)
  PORT = 4000;

  @Expose() @IsString() @IsNotEmpty()
  DATABASE_URL!: string;

  // Local-only default lives in .env.example; real environments use a secrets manager.
  @Expose() @IsString() @IsNotEmpty()
  JWT_SECRET!: string;

  @Expose() @IsString() @IsNotEmpty()
  REDIS_URL = 'redis://localhost:6379';

  @Expose() @IsString() @IsNotEmpty()
  S3_BUCKET!: string;

  @Expose() @IsString() @IsNotEmpty()
  S3_REGION = 'us-east-1';

  /** Unset on real AWS: the SDK then uses the default endpoint and the task's IAM role. */
  @Expose() @IsOptional() @IsString()
  S3_ENDPOINT?: string;

  /** Host browsers use for pre-signed URLs; defaults to S3_ENDPOINT. */
  @Expose() @IsOptional() @IsString()
  S3_PUBLIC_ENDPOINT?: string;

  @Expose() @IsOptional() @IsString()
  S3_ACCESS_KEY_ID?: string;

  @Expose() @IsOptional() @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @Expose() @IsString() @IsNotEmpty()
  SMTP_URL = 'smtp://localhost:1025';

  @Expose() @IsString() @IsNotEmpty()
  MAIL_FROM = 'Service Portal <no-reply@portal.local>';

  @Expose() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  MOCK_EMAIL_FAILURE_RATE = 0.3;

  @Expose() @Type(() => Number) @IsInt() @Min(1)
  NOTIFICATION_BACKOFF_MS = 2000;

  @Expose() @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  @Expose() @Type(() => Number) @IsInt() @Min(1)
  LOGIN_RATE_LIMIT = 5;

  /** Proxies in front of the API: 1 behind the Next.js server, 2 behind ALB + Next.js. */
  @Expose() @Type(() => Number) @IsInt() @Min(0)
  TRUST_PROXY_HOPS = 0;
}

/** Reads and checks the environment; throws one error listing every bad setting. */
export function validateEnv(env: NodeJS.ProcessEnv): Env {
  const config = plainToInstance(Env, env, {
    excludeExtraneousValues: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(config);
  if (errors.length > 0) {
    const problems = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return config;
}

// Read when the app starts (not when this file is imported), so tests can set
// variables just before creating the app.
export const appConfig = registerAs('app', () => validateEnv(process.env));
export type AppConfig = ConfigType<typeof appConfig>;
