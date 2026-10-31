import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAttachments1761811200000 implements MigrationInterface {
  name = 'CreateAttachments1761811200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE attachment_status AS ENUM ('PENDING', 'UPLOADED')`,
    );
    await queryRunner.query(`
      CREATE TABLE attachments (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id   uuid NOT NULL REFERENCES service_requests(id),
        object_key   text NOT NULL UNIQUE,
        content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
        size_bytes   integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
        status       attachment_status NOT NULL,
        uploaded_by  uuid NOT NULL REFERENCES users(id),
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX attachments_request_idx ON attachments (request_id, created_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE attachments`);
    await queryRunner.query(`DROP TYPE attachment_status`);
  }
}
