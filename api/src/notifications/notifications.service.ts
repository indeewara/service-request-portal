import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { RequestStatus } from '../requests/service-request.entity.js';
import { Notification, NotificationStatus } from './notification.entity.js';
import { redisUrl } from './redis.js';

export const NOTIFICATIONS_QUEUE = 'notifications';
export interface EmailJob {
  notificationId: string;
  /** The request that caused the email, so worker logs can be traced back. Absent when the sweeper re-queues. */
  correlationId?: string;
}

const MAX_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 30_000;

/** Producer side: records owed emails and puts them on the queue. */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  readonly queue = new Queue<EmailJob>(NOTIFICATIONS_QUEUE, {
    connection: { url: redisUrl() },
  });
  private sweeper?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  /** Call inside the status-change transaction (outbox pattern). */
  async recordStatusChange(
    m: EntityManager,
    change: {
      requestId: string;
      statusHistoryId: string;
      recipientId: string;
      toStatus: RequestStatus;
      orderNumber: string;
    },
  ): Promise<string> {
    const notification = await m.save(
      m.create(Notification, { ...change, status: NotificationStatus.PENDING }),
    );
    return notification.id;
  }

  /** jobId = notification id, so queueing the same notification twice is a no-op. */
  async enqueue(notificationId: string, correlationId?: string): Promise<void> {
    await this.queue.add(
      'status-email',
      { notificationId, correlationId },
      {
        jobId: notificationId,
        attempts: MAX_ATTEMPTS,
        // Waits 1×, 2×, 4×, 8× the delay between attempts.
        backoff: {
          type: 'exponential',
          delay: Number(process.env.NOTIFICATION_BACKOFF_MS ?? 2000),
        },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: false,
      },
    );
  }

  /** Call after the transaction commits. If Redis is down, the sweeper retries later. */
  async enqueueAfterCommit(notificationId: string, correlationId?: string): Promise<void> {
    try {
      await this.enqueue(notificationId, correlationId);
    } catch {
      this.logger.warn({ msg: 'Enqueue failed; sweeper will retry', notificationId });
    }
  }

  /** Re-queues emails that were recorded but never made it onto the queue. */
  async sweep(): Promise<void> {
    const stale = await this.notifications.find({
      where: {
        status: NotificationStatus.PENDING,
        createdAt: LessThan(new Date(Date.now() - SWEEP_INTERVAL_MS)),
      },
      take: 100,
    });
    for (const { id } of stale) await this.enqueueAfterCommit(id);
  }

  onModuleInit() {
    this.queue.on('error', (err) =>
      this.logger.error({ msg: 'Queue connection error', error: err.message }),
    );
    this.sweeper = setInterval(() => {
      this.sweep().catch(() => this.logger.warn('Notification sweep failed'));
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.sweeper);
    await this.queue.close();
  }
}
