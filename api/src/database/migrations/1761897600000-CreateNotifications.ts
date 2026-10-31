import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1761897600000 implements MigrationInterface {
  name = 'CreateNotifications1761897600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED')`,
    );
    // UNIQUE status_history_id: at most one email per status change.
    await queryRunner.query(`
      CREATE TABLE notifications (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id        uuid NOT NULL REFERENCES service_requests(id),
        status_history_id uuid NOT NULL UNIQUE REFERENCES request_status_history(id),
        recipient_id      uuid NOT NULL REFERENCES users(id),
        to_status         request_status NOT NULL,
        order_number      text NOT NULL,
        status            notification_status NOT NULL,
        attempts          integer NOT NULL DEFAULT 0,
        last_error        text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        sent_at           timestamptz
      )
    `);
    // The sweeper only looks at PENDING rows.
    await queryRunner.query(
      `CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDING'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notifications`);
    await queryRunner.query(`DROP TYPE notification_status`);
  }
}
