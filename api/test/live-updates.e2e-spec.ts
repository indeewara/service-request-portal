import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedUsers } from '../src/database/seed.js';

// Needs Postgres and Redis running and api/.env present.
describe('Live status updates over SSE (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let alice: string;
  let bob: string;
  let staff: string;

  const call = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  const tokenFor = async (email: string) => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123!' }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };

  /** Reads the stream until an event of `type` arrives; returns its parsed data. */
  async function nextEvent(body: ReadableStream<Uint8Array>, type: string) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Stream ended');
        buffer += decoder.decode(value, { stream: true });
        for (const block of buffer.split('\n\n').slice(0, -1)) {
          if (block.includes(`event: ${type}`)) {
            const data = block.split('\n').find((l) => l.startsWith('data: '))!;
            return JSON.parse(data.slice(6)) as unknown;
          }
        }
      }
    } finally {
      await reader.cancel();
    }
  }

  beforeAll(async () => {
    process.loadEnvFile();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    base = await app.getUrl();
    base = base.replace('[::1]', 'localhost');
    await seedUsers(app.get(DataSource));
    [alice, bob, staff] = await Promise.all([
      tokenFor('alice@example.com'),
      tokenFor('bob@example.com'),
      tokenFor('staff@example.com'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createRequest() {
    const res = await call('/requests', alice, {
      method: 'POST',
      body: JSON.stringify({ category: 'OTHER', orderNumber: 'SO-LIVE-1', description: 'Live test.' }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  it("pushes a status change to the customer's open stream", async () => {
    const id = await createRequest();
    const stream = await call(`/requests/${id}/events`, alice);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');

    const event = nextEvent(stream.body!, 'status');
    const patch = await call(`/requests/${id}/status`, staff, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'IN_REVIEW' }),
    });
    expect(patch.status).toBe(200);
    expect(await event).toEqual({ requestId: id, status: 'IN_REVIEW' });
  });

  it("returns 404 for another customer's request stream", async () => {
    const id = await createRequest();
    const res = await call(`/requests/${id}/events`, bob);
    expect(res.status).toBe(404);
  });
});
