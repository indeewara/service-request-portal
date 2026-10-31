import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { appConfig, type AppConfig } from '../config/app.config.js';

export interface EmailMessage {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Stand-in for a real email API. Delivers to Mailpit over SMTP and fails on
 * purpose at MOCK_EMAIL_FAILURE_RATE: half of failures happen before sending,
 * half after (delivered, but the caller sees an error, like a timed-out
 * response). Like real providers, it honours an idempotency key, so a retry
 * after the second kind of failure doesn't send the email again.
 */
@Injectable()
export class MockEmailProvider implements OnModuleDestroy {
  private readonly logger = new Logger(MockEmailProvider.name);
  failureRate: number;
  /** Returns 0–1 per call; below failureRate means failure. Replaceable in tests. */
  roll: (message: EmailMessage) => number = () => Math.random();

  // Stands for the provider's own key store, which outlives our process.
  private readonly redis: Redis;
  private readonly smtp: Transporter;

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {
    this.failureRate = config.MOCK_EMAIL_FAILURE_RATE;
    this.redis = new Redis(config.REDIS_URL).on('error', (err) =>
      this.logger.error({ msg: 'Mock provider Redis error', error: err.message }),
    );
    this.smtp = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(message: EmailMessage): Promise<void> {
    const roll = this.roll(message);
    if (roll < this.failureRate / 2) {
      throw new Error('Mock provider: service unavailable');
    }

    const key = `mock-email:sent:${message.idempotencyKey}`;
    const firstTime = await this.redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    if (firstTime) {
      try {
        await this.smtp.sendMail({
          from: this.config.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          headers: { 'X-Idempotency-Key': message.idempotencyKey },
        });
      } catch (err) {
        await this.redis.del(key);
        throw err;
      }
    }

    if (roll < this.failureRate) {
      throw new Error('Mock provider: timed out after accepting the message');
    }
  }

  async onModuleDestroy() {
    this.smtp.close();
    await this.redis.quit();
  }
}
