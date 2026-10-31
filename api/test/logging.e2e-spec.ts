import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedUsers } from '../src/database/seed.js';
import { Notification } from '../src/notifications/notification.entity.js';
import { MockEmailProvider } from '../src/notifications/mock-email.provider.js';

// Needs Postgres, Redis and Mailpit running and api/.env present.
describe('Structured logs (e2e)', () => {
  let app: INestApplication;
  const lines: string[] = [];
  const api = () => request(app.getHttpServer());
  const logs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    process.loadEnvFile();
    const write = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => {
      const text = String(chunk);
      if (text.startsWith('{')) lines.push(...text.trim().split('\n'));
      return write(chunk, ...(rest as []));
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await seedUsers(app.get(DataSource));
    app.get(MockEmailProvider).failureRate = 0;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('logs JSON with the correlation id and no personal data', async () => {
    const description = `Cracked tiles ${randomUUID()}`;
    const login = async (email: string) =>
      (await api().post('/auth/login').send({ email, password: 'Password123!' }).expect(200))
        .body.accessToken as string;
    const [alice, staff] = [await login('alice@example.com'), await login('staff@example.com')];
    await api().post('/auth/login').send({ email: 'alice@example.com', password: 'wrong' }).expect(401);

    const created = await api()
      .post('/requests')
      .auth(alice, { type: 'bearer' })
      .send({ category: 'QUALITY_ISSUE', orderNumber: 'SO-LOGS-1', description })
      .expect(201);
    const trace = `trace-${randomUUID()}`;
    await api()
      .patch(`/requests/${created.body.id}/status`)
      .set('x-correlation-id', trace)
      .auth(staff, { type: 'bearer' })
      .send({ status: 'IN_REVIEW' })
      .expect(200);

    // Wait for the email job, which logs from the worker, outside the request.
    const repo = app.get(DataSource).getRepository(Notification);
    for (let i = 0; i < 100; i++) {
      const n = await repo.findOneBy({ requestId: created.body.id });
      if (n?.status === 'SENT') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 50));

    // Every line is JSON (JSON.parse throws otherwise).
    const all = logs();
    expect(all.length).toBeGreaterThan(0);

    // The request line and the worker line both carry the caller's correlation id.
    expect(all).toContainEqual(
      expect.objectContaining({
        correlationId: trace,
        req: { method: 'PATCH', path: `/requests/${created.body.id}/status` },
        res: { statusCode: 200 },
        role: 'STAFF',
      }),
    );
    expect(all).toContainEqual(
      expect.objectContaining({ msg: 'Status email sent', correlationId: trace }),
    );

    // No personal data or secrets anywhere.
    const text = lines.join('\n');
    for (const secret of [
      'alice@example.com',
      'staff@example.com',
      'Alice Customer',
      'Sam Staff',
      description,
      'Password123!',
      alice,
      'authorization',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('logs requests rejected before routing with their correlation id', async () => {
    await api()
      .post('/auth/login')
      .set('x-correlation-id', 'too-big-1')
      .send({ email: 'a@b.co', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(logs()).toContainEqual(
      expect.objectContaining({ correlationId: 'too-big-1', statusCode: 413, level: 'warn' }),
    );
  });
});
