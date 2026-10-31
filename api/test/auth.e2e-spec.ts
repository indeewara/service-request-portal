import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedUsers } from '../src/database/seed.js';

// Needs Postgres running (`docker compose up db`) and api/.env present.
describe('POST /auth/login (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.loadEnvFile();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await seedUsers(app.get(DataSource));
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/auth/login').send(body);

  it('returns a JWT and the user for valid credentials', async () => {
    const res = await login({
      email: 'Alice@Example.com',
      password: 'Password123!',
    }).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: 'Alice Customer',
      role: 'CUSTOMER',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await login({
      email: 'alice@example.com',
      password: 'nope',
    }).expect(401);
    const unknown = await login({
      email: 'nobody@example.com',
      password: 'nope',
    }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects an invalid body with 400', async () => {
    await login({ email: 'not-an-email' }).expect(400);
  });
});
