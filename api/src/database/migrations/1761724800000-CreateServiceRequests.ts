import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceRequests1761724800000 implements MigrationInterface {
  name = 'CreateServiceRequests1761724800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE request_status AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE request_category AS ENUM ('DAMAGED_DELIVERY', 'WRONG_ITEM', 'QUALITY_ISSUE', 'OTHER')`,
    );
    await queryRunner.query(`
      CREATE TABLE service_requests (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id  uuid NOT NULL REFERENCES users(id),
        order_number text NOT NULL,
        category     request_category NOT NULL,
        description  text NOT NULL,
        status       request_status NOT NULL DEFAULT 'NEW',
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    // "My requests" and the staff dashboard (filter by status, newest first).
    await queryRunner.query(
      `CREATE INDEX service_requests_customer_created_idx ON service_requests (customer_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX service_requests_status_created_idx ON service_requests (status, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE request_status_history (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id  uuid NOT NULL REFERENCES service_requests(id),
        from_status request_status,
        to_status   request_status NOT NULL,
        changed_by  uuid NOT NULL REFERENCES users(id),
        changed_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX request_status_history_request_idx ON request_status_history (request_id, changed_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE request_status_history`);
    await queryRunner.query(`DROP TABLE service_requests`);
    await queryRunner.query(`DROP TYPE request_category`);
    await queryRunner.query(`DROP TYPE request_status`);
  }
}
