import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Needs Postgres and Redis running and api/.env present.
describe('Error format, correlation id and docs (e2e)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.loadEnvFile();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns validation failures as message + details', async () => {
    const res = await api().post('/auth/login').send({ email: 'not-an-email' }).expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: expect.arrayContaining(['email must be an email']),
      correlationId: expect.any(String),
    });
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });

  it("echoes the caller's correlation id on errors", async () => {
    const res = await api().get('/nope').set('x-correlation-id', 'trace-42').expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /nope',
      correlationId: 'trace-42',
    });
  });

  it('replaces a correlation id that could inject into logs', async () => {
    const res = await api().get('/nope').set('x-correlation-id', 'bad id\tinjected').expect(404);
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports one problem per invalid field', async () => {
    const res = await api().post('/auth/login').send({}).expect(400);
    expect(res.body.details).toEqual(['email must be an email', 'password must be a string']);
  });

  it('returns 413, not 500, for an oversized body', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(res.body).toMatchObject({ statusCode: 413, error: 'Payload Too Large' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await api().get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/requests', '/requests/{id}/events']),
    );
  });
});
