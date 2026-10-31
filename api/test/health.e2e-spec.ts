import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { StorageService } from '../src/attachments/storage.service.js';

// Needs Postgres, Redis and LocalStack running and api/.env present.
describe('Health and login rate limit (e2e)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.loadEnvFile();
    process.env.LOGIN_RATE_LIMIT = '3';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it('reports every dependency up without a token', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up', storage: 'up' },
    });
  });

  it('returns 503 and names the failing dependency, without details', async () => {
    vi.spyOn(app.get(StorageService), 'ping').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:443'),
    );
    const res = await api().get('/health').expect(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'up', storage: 'down' },
    });
  });

  it('marks a hanging dependency down after the timeout', async () => {
    vi.spyOn(app.get(StorageService), 'ping').mockReturnValue(new Promise(() => {}));
    const res = await api().get('/health').expect(503);
    expect(res.body.checks.storage).toBe('down');
  });

  it('blocks login attempts over the limit with 429', async () => {
    const attempt = () =>
      api().post('/auth/login').send({ email: 'alice@example.com', password: 'wrong' });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many login attempts. Try again in a minute.',
      correlationId: expect.any(String),
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Other endpoints are not limited.
    await api().get('/health').expect(200);
  });
});
