import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedUsers } from '../src/database/seed.js';
import {
  EmailMessage,
  MockEmailProvider,
} from '../src/notifications/mock-email.provider.js';
import { Notification } from '../src/notifications/notification.entity.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

// Needs Postgres, Redis and Mailpit running and api/.env present.
describe('Status-change emails (e2e)', () => {
  let app: INestApplication;
  let alice: string;
  let staff: string;
  let provider: MockEmailProvider;
  let notifications: NotificationsService;
  // Per-message dice rolls, keyed by order number in the subject. Others use Math.random.
  const scripted = new Map<string, number[]>();

  const api = () => request(app.getHttpServer());
  const tokenFor = async (email: string) =>
    (
      await api()
        .post('/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200)
    ).body.accessToken as string;

  async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error('Timed out waiting');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const mailpitCount = async (orderNumber: string) => {
    const res = await fetch(
      `http://localhost:8025/api/v1/search?query=${encodeURIComponent(orderNumber)}`,
    );
    return ((await res.json()) as { messages_count: number }).messages_count;
  };

  /** Creates a request and moves it to IN_REVIEW; returns its notification row once settled. */
  async function changeStatusWithRolls(rolls: number[]) {
    const orderNumber = `SO-${randomUUID().slice(0, 8).toUpperCase()}`;
    scripted.set(orderNumber, rolls);
    const { body } = await api()
      .post('/requests')
      .auth(alice, { type: 'bearer' })
      .send({ category: 'WRONG_ITEM', orderNumber, description: 'Wrong bricks.' })
      .expect(201);
    await api()
      .patch(`/requests/${body.id}/status`)
      .auth(staff, { type: 'bearer' })
      .send({ status: 'IN_REVIEW' })
      .expect(200);

    const repo = app.get(DataSource).getRepository(Notification);
    const notification = await waitFor(async () => {
      const n = await repo.findOneBy({ requestId: body.id });
      return n && n.status !== 'PENDING' ? n : undefined;
    });
    return { orderNumber, notification };
  }

  beforeAll(async () => {
    process.loadEnvFile();
    process.env.NOTIFICATION_BACKOFF_MS = '20';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await seedUsers(app.get(DataSource));
    [alice, staff] = await Promise.all([
      tokenFor('alice@example.com'),
      tokenFor('staff@example.com'),
    ]);

    provider = app.get(MockEmailProvider);
    notifications = app.get(NotificationsService);
    provider.failureRate = 0.5;
    provider.roll = (message: EmailMessage) => {
      const order = [...scripted.keys()].find((o) => message.subject.includes(o));
      return order ? (scripted.get(order)!.shift() ?? 0.99) : Math.random();
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends exactly one email when the provider succeeds first time', async () => {
    const { orderNumber, notification } = await changeStatusWithRolls([0.99]);
    expect(notification).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
    await waitFor(async () => ((await mailpitCount(orderNumber)) === 1 ? true : undefined));
  });

  it('retries after failures and still delivers exactly one email', async () => {
    // Attempt 1 fails before sending; attempt 2 delivers but reports a timeout;
    // attempt 3 hits the idempotency key, so nothing new is sent.
    const { orderNumber, notification } = await changeStatusWithRolls([0.1, 0.4, 0.99]);
    expect(notification).toMatchObject({ status: 'SENT', attempts: 3, lastError: null });
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailpitCount(orderNumber)).toBe(1);
  });

  it('keeps the job and marks it FAILED after 5 failed attempts', async () => {
    const { orderNumber, notification } = await changeStatusWithRolls([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(notification).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      lastError: 'Mock provider: service unavailable',
    });
    const job = await notifications.queue.getJob(notification.id);
    expect(await job?.getState()).toBe('failed');
    expect(await mailpitCount(orderNumber)).toBe(0);
  });

  it('does not send again when the same notification is queued twice', async () => {
    const { orderNumber, notification } = await changeStatusWithRolls([0.99]);
    await notifications.enqueue(notification.id);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailpitCount(orderNumber)).toBe(1);
  });

  it('sends an email whose job never reached the queue (sweeper)', async () => {
    const orderNumber = `SO-${randomUUID().slice(0, 8).toUpperCase()}`;
    scripted.set(orderNumber, [0.99]);
    // Redis refuses the job once: the status change still commits, the email stays PENDING.
    vi.spyOn(notifications.queue, 'add').mockRejectedValueOnce(new Error('Redis down'));
    const { body } = await api()
      .post('/requests')
      .auth(alice, { type: 'bearer' })
      .send({ category: 'WRONG_ITEM', orderNumber, description: 'Wrong bricks.' })
      .expect(201);
    await api()
      .patch(`/requests/${body.id}/status`)
      .auth(staff, { type: 'bearer' })
      .send({ status: 'IN_REVIEW' })
      .expect(200);

    const repo = app.get(DataSource).getRepository(Notification);
    const lost = await repo.findOneByOrFail({ requestId: body.id });
    expect(lost.status).toBe('PENDING');
    expect(await notifications.queue.getJob(lost.id)).toBeFalsy();

    // The sweeper only picks up rows older than its interval, so age this one first.
    await repo.update(lost.id, { createdAt: new Date(Date.now() - 60_000) });
    await notifications.sweep();

    const sent = await waitFor(async () => {
      const n = await repo.findOneBy({ id: lost.id });
      return n?.status === 'SENT' ? n : undefined;
    });
    expect(sent.attempts).toBe(1);
    await waitFor(async () => ((await mailpitCount(orderNumber)) === 1 ? true : undefined));
  });
});
