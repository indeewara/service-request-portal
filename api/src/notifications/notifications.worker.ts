import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { Repository } from 'typeorm';
import { UsersService } from '../auth/users.service.js';
import { RequestStatus } from '../common/request-status.js';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { Notification, NotificationStatus } from './notification.entity.js';
import { EmailJob, NOTIFICATIONS_QUEUE } from './notifications.service.js';

const STATUS_LABELS: Record<RequestStatus, string> = {
  [RequestStatus.NEW]: 'New',
  [RequestStatus.IN_REVIEW]: 'In review',
  [RequestStatus.RESOLVED]: 'Resolved',
  [RequestStatus.REJECTED]: 'Rejected',
};

// Plain text only. The customer's description is deliberately left out.
function renderStatusEmail(name: string, n: Notification) {
  const status = STATUS_LABELS[n.toStatus];
  return {
    subject: `Your service request for order ${n.orderNumber} is now ${status}`,
    text:
      `Hi ${name},\n\n` +
      `Your service request for order ${n.orderNumber} is now: ${status}.\n\n` +
      `You can follow it in the Service Request Portal.\n`,
  };
}

/** Consumer side: sends one status email per job. Logs ids only, never addresses. */
@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsWorker.name);
  private worker?: Worker<EmailJob>;

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly users: UsersService,
    private readonly email: MockEmailProvider,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.worker = new Worker<EmailJob>(
      NOTIFICATIONS_QUEUE,
      (job) => this.process(job),
      { connection: { url: this.config.REDIS_URL }, concurrency: 5 },
    );
    this.worker.on('error', (err) =>
      this.logger.error({ msg: 'Worker connection error', error: err.message }),
    );
    this.worker.on('failed', (job, err) => {
      if (job) void this.onFailed(job, err);
    });
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { notificationId } = job.data;
    const notification = await this.notifications.findOneBy({ id: notificationId });
    // Already sent (e.g. a re-queued duplicate): never send twice.
    if (!notification || notification.status === NotificationStatus.SENT) return;

    await this.notifications.increment({ id: notificationId }, 'attempts', 1);
    const recipient = await this.users.findContact(notification.recipientId);
    if (!recipient) throw new UnrecoverableError('Recipient not found');

    // Same idempotency key on every retry, so the provider drops repeats.
    await this.email.send({
      idempotencyKey: notificationId,
      to: recipient.email,
      ...renderStatusEmail(recipient.name, notification),
    });

    await this.notifications.update(notificationId, {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      lastError: null,
    });
    this.logger.log({
      msg: 'Status email sent',
      notificationId,
      correlationId: job.data.correlationId,
      attempt: job.attemptsMade + 1,
    });
  }

  private async onFailed(job: Job<EmailJob>, err: Error) {
    const final =
      err instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.notifications.update(job.data.notificationId, {
      lastError: err.message,
      ...(final && { status: NotificationStatus.FAILED }),
    });
    // Error text stays in the DB row: provider errors can echo the address.
    this.logger.warn({
      msg: final ? 'Status email failed permanently' : 'Status email attempt failed',
      notificationId: job.data.notificationId,
      correlationId: job.data.correlationId,
      attempt: job.attemptsMade,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
