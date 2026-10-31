import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { seedUsers } from '../src/database/seed.js';

// Needs Postgres running (`docker compose up db`) and api/.env present.
describe('Service requests (e2e)', () => {
  let app: INestApplication;
  let alice: string;
  let bob: string;
  let staff: string;

  const api = () => request(app.getHttpServer());
  const tokenFor = async (email: string) =>
    (
      await api()
        .post('/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200)
    ).body.accessToken as string;
  const create = (token: string, orderNumber = 'SO-1001') =>
    api().post('/requests').auth(token, { type: 'bearer' }).send({
      category: 'DAMAGED_DELIVERY',
      orderNumber,
      description: 'Two bags of cement arrived split open.',
    });

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

  describe('POST /requests', () => {
    it('creates a NEW request owned by the caller, with a history entry', async () => {
      const created = await create(alice, ' so-1001 ').expect(201);
      expect(created.body).toMatchObject({
        status: 'NEW',
        orderNumber: 'SO-1001',
        category: 'DAMAGED_DELIVERY',
      });

      const details = await api()
        .get(`/requests/${created.body.id}`)
        .auth(alice, { type: 'bearer' })
        .expect(200);
      expect(details.body.history).toMatchObject([
        { fromStatus: null, toStatus: 'NEW' },
      ]);
    });

    it('stores the request and its first history row in the database', async () => {
      const created = await create(alice, 'SO-DB-1').expect(201);
      const db = app.get(DataSource);
      const [aliceRow] = await db.query(
        `SELECT id FROM users WHERE email = 'alice@example.com'`,
      );

      const [row] = await db.query(
        `SELECT customer_id, order_number, category, status, description
           FROM service_requests WHERE id = $1`,
        [created.body.id],
      );
      expect(row).toEqual({
        customer_id: aliceRow.id,
        order_number: 'SO-DB-1',
        category: 'DAMAGED_DELIVERY',
        status: 'NEW',
        description: 'Two bags of cement arrived split open.',
      });

      const history = await db.query(
        `SELECT from_status, to_status, changed_by
           FROM request_status_history WHERE request_id = $1`,
        [created.body.id],
      );
      expect(history).toEqual([
        { from_status: null, to_status: 'NEW', changed_by: aliceRow.id },
      ]);
    });

    it('saves nothing when the order number is rejected', async () => {
      const db = app.get(DataSource);
      const count = async () =>
        Number(
          (
            await db.query(
              `SELECT count(*) FROM service_requests WHERE order_number = 'XX-NOPE'`,
            )
          )[0].count,
        );
      await create(alice, 'XX-NOPE').expect(422);
      expect(await count()).toBe(0);
    });

    it('rejects an order number the ERP does not know', async () => {
      await create(alice, 'PO-1').expect(422);
    });

    it('rejects an invalid body', async () => {
      await api()
        .post('/requests')
        .auth(alice, { type: 'bearer' })
        .send({ category: 'NOPE', orderNumber: 'SO-1' })
        .expect(400);
    });

    it('refuses a customerId sent by the client', async () => {
      await api()
        .post('/requests')
        .auth(alice, { type: 'bearer' })
        .send({
          category: 'OTHER',
          orderNumber: 'SO-1',
          description: 'x',
          customerId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });

    it('requires a token and the CUSTOMER role', async () => {
      await api().post('/requests').send({}).expect(401);
      await create(staff).expect(403);
    });
  });

  describe('customer isolation', () => {
    it("hides Alice's request from Bob everywhere", async () => {
      const { body } = await create(alice).expect(201);

      await api()
        .get(`/requests/${body.id}`)
        .auth(bob, { type: 'bearer' })
        .expect(404);

      const bobsList = await api()
        .get('/requests/mine')
        .auth(bob, { type: 'bearer' })
        .expect(200);
      expect(
        bobsList.body.items.map((r: { id: string }) => r.id),
      ).not.toContain(body.id);

      await api().get('/requests').auth(bob, { type: 'bearer' }).expect(403);
    });

    it('/requests/mine returns only the caller’s requests', async () => {
      const { body } = await api()
        .get('/requests/mine?pageSize=100')
        .auth(alice, { type: 'bearer' })
        .expect(200);
      expect(body.items.length).toBeGreaterThan(0);
      const me = await api()
        .get(`/requests/${body.items[0].id}`)
        .auth(alice, { type: 'bearer' });
      for (const r of body.items) expect(r.customerId).toBe(me.body.customerId);
    });
  });

  describe('status workflow', () => {
    it('lets staff move a request through the workflow and records who did it', async () => {
      const { body } = await create(alice).expect(201);
      const patch = (token: string, status: string) =>
        api()
          .patch(`/requests/${body.id}/status`)
          .auth(token, { type: 'bearer' })
          .send({ status });

      await patch(alice, 'IN_REVIEW').expect(403);
      await patch(staff, 'RESOLVED').expect(409);
      await patch(staff, 'IN_REVIEW').expect(200);
      await patch(staff, 'RESOLVED').expect(200);
      await patch(staff, 'REJECTED').expect(409);

      const details = await api()
        .get(`/requests/${body.id}`)
        .auth(staff, { type: 'bearer' })
        .expect(200);
      expect(details.body.status).toBe('RESOLVED');
      expect(
        details.body.history.map((h: { toStatus: string }) => h.toStatus),
      ).toEqual(['NEW', 'IN_REVIEW', 'RESOLVED']);
      expect(details.body.history[1].changedBy).not.toBe(body.customerId);
    });
  });

  describe('customer details', () => {
    it('shows staff who raised a request, and never shows them to customers', async () => {
      const { body } = await create(alice).expect(201);

      const forStaff = await api()
        .get(`/requests/${body.id}`)
        .auth(staff, { type: 'bearer' })
        .expect(200);
      expect(forStaff.body.customer).toEqual({
        name: 'Alice Customer',
        email: 'alice@example.com',
      });

      const forAlice = await api()
        .get(`/requests/${body.id}`)
        .auth(alice, { type: 'bearer' })
        .expect(200);
      expect(forAlice.body).not.toHaveProperty('customer');

      // The staff list carries the name only, no email.
      const list = await api()
        .get('/requests?pageSize=100')
        .auth(staff, { type: 'bearer' })
        .expect(200);
      const row = list.body.items.find((r: { id: string }) => r.id === body.id);
      expect(row.customerName).toBe('Alice Customer');
      expect(JSON.stringify(list.body)).not.toContain('@example.com');

      const mine = await api()
        .get('/requests/mine?pageSize=100')
        .auth(alice, { type: 'bearer' })
        .expect(200);
      expect(mine.body.items[0]).not.toHaveProperty('customerName');
    });
  });

  describe('GET /requests (staff)', () => {
    it('filters by status and category and paginates', async () => {
      const { body } = await api()
        .get('/requests?status=NEW&category=DAMAGED_DELIVERY&page=1&pageSize=2')
        .auth(staff, { type: 'bearer' })
        .expect(200);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
      expect(body.items.length).toBeLessThanOrEqual(2);
      for (const r of body.items) {
        expect(r).toMatchObject({
          status: 'NEW',
          category: 'DAMAGED_DELIVERY',
        });
      }
    });

    it('filters by date range', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const inRange = await api()
        .get(`/requests?from=${today}&to=${today}`)
        .auth(staff, { type: 'bearer' })
        .expect(200);
      expect(inRange.body.total).toBeGreaterThan(0);

      const past = await api()
        .get('/requests?to=2000-01-01')
        .auth(staff, { type: 'bearer' })
        .expect(200);
      expect(past.body.total).toBe(0);
    });

    it('rejects bad filter values', async () => {
      await api()
        .get('/requests?status=DONE')
        .auth(staff, { type: 'bearer' })
        .expect(400);
      await api()
        .get('/requests?pageSize=1000')
        .auth(staff, { type: 'bearer' })
        .expect(400);
    });
  });
});
