import { GetPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { StorageService } from '../src/attachments/storage.service.js';
import { seedUsers } from '../src/database/seed.js';

// Needs Postgres and LocalStack running (`docker compose up db localstack`) and api/.env present.
describe('Photo attachments (e2e)', () => {
  let app: INestApplication;
  let alice: string;
  let bob: string;
  let staff: string;

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(100, 1),
  ]);

  const api = () => request(app.getHttpServer());
  const tokenFor = async (email: string) =>
    (
      await api()
        .post('/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200)
    ).body.accessToken as string;

  const newRequest = async () =>
    (
      await api()
        .post('/requests')
        .auth(alice, { type: 'bearer' })
        .send({
          category: 'DAMAGED_DELIVERY',
          orderNumber: 'SO-77',
          description: 'Cracked tiles.',
        })
        .expect(201)
    ).body.id as string;

  const uploadUrl = (requestId: string, body: object, token = alice) =>
    api()
      .post(`/requests/${requestId}/attachments/upload-url`)
      .auth(token, { type: 'bearer' })
      .send(body);

  const complete = (requestId: string, attachmentId: string) =>
    api()
      .post(`/requests/${requestId}/attachments/${attachmentId}/complete`)
      .auth(alice, { type: 'bearer' });

  // What the browser does: multipart POST straight to S3, policy fields first.
  const uploadToS3 = (
    target: { url: string; fields: Record<string, string> },
    file: Buffer,
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file)]));
    return fetch(target.url, { method: 'POST', body: form });
  };

  beforeAll(async () => {
    process.loadEnvFile();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
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

  it('uploads a photo straight to S3 and serves it via a short-lived URL', async () => {
    const requestId = await newRequest();
    const { body: target } = await uploadUrl(requestId, {
      contentType: 'image/png',
      size: PNG.length,
    }).expect(201);
    expect(target.expiresIn).toBe(300);

    await complete(requestId, target.attachmentId).expect(409); // nothing uploaded yet

    expect((await uploadToS3(target, PNG)).ok).toBe(true);
    const done = await complete(requestId, target.attachmentId).expect(200);
    expect(done.body).toMatchObject({ status: 'UPLOADED', sizeBytes: PNG.length });

    // Staff can view it too.
    const { body: photos } = await api()
      .get(`/requests/${requestId}/attachments`)
      .auth(staff, { type: 'bearer' })
      .expect(200);
    expect(photos).toHaveLength(1);
    expect(photos[0].url).toContain('X-Amz-Signature');

    const signed = await fetch(photos[0].url);
    expect(signed.status).toBe(200);
    expect(Buffer.from(await signed.arrayBuffer())).toEqual(PNG);

  });

  // LocalStack community does not enforce auth, so an unsigned GET can't be
  // shown to fail locally. Assert the configuration that makes real S3 refuse it.
  it('keeps the bucket private', async () => {
    const storage = app.get(StorageService);
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    const { PublicAccessBlockConfiguration } = await s3.send(
      new GetPublicAccessBlockCommand({ Bucket: storage.bucket }),
    );
    expect(PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });
  });

  it('rejects disallowed types and sizes before issuing a URL', async () => {
    const requestId = await newRequest();
    await uploadUrl(requestId, { contentType: 'image/gif', size: 10 }).expect(400);
    await uploadUrl(requestId, {
      contentType: 'image/png',
      size: 5 * 1024 * 1024 + 1,
    }).expect(400);
  });

  it('lets S3 refuse a file over 5 MB even if the client lied about its size', async () => {
    const requestId = await newRequest();
    const { body: target } = await uploadUrl(requestId, {
      contentType: 'image/png',
      size: 1000,
    }).expect(201);
    const tooBig = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await uploadToS3(target, tooBig);
    expect(res.ok).toBe(false);
    expect(await res.text()).toContain('EntityTooLarge');
  });

  it('lets S3 refuse a different Content-Type than the one signed', async () => {
    const requestId = await newRequest();
    const { body: target } = await uploadUrl(requestId, {
      contentType: 'image/png',
      size: PNG.length,
    }).expect(201);
    const res = await uploadToS3(
      { ...target, fields: { ...target.fields, 'Content-Type': 'text/html' } },
      PNG,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Policy Condition failed');
  });

  it('discards a file that is not really an image', async () => {
    const requestId = await newRequest();
    const { body: target } = await uploadUrl(requestId, {
      contentType: 'image/png',
      size: 20,
    }).expect(201);
    await uploadToS3(target, Buffer.from('<script>alert(1)</script>'));

    await complete(requestId, target.attachmentId).expect(422);
    const { body: photos } = await api()
      .get(`/requests/${requestId}/attachments`)
      .auth(alice, { type: 'bearer' })
      .expect(200);
    expect(photos).toHaveLength(0);
    // The row is gone too, so it no longer holds one of the 5 photo slots.
    const rows = await app
      .get(DataSource)
      .query('SELECT id FROM attachments WHERE request_id = $1', [requestId]);
    expect(rows).toEqual([]);
  });

  it('allows at most 5 photos per request', async () => {
    const requestId = await newRequest();
    for (let i = 0; i < 5; i++) {
      await uploadUrl(requestId, { contentType: 'image/png', size: 10 }).expect(201);
    }
    await uploadUrl(requestId, { contentType: 'image/png', size: 10 }).expect(409);
  });

  it("hides Alice's photos from Bob and blocks staff uploads", async () => {
    const requestId = await newRequest();
    await uploadUrl(requestId, { contentType: 'image/png', size: 10 }, bob).expect(404);
    await api()
      .get(`/requests/${requestId}/attachments`)
      .auth(bob, { type: 'bearer' })
      .expect(404);
    await uploadUrl(requestId, { contentType: 'image/png', size: 10 }, staff).expect(403);
  });
});
