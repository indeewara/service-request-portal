import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1761638400000 implements MigrationInterface {
  name = 'CreateUsers1761638400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE user_role AS ENUM ('CUSTOMER', 'STAFF')`,
    );
    await queryRunner.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email         text NOT NULL UNIQUE CHECK (email = lower(email)),
        name          text NOT NULL,
        password_hash text NOT NULL,
        role          user_role NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE users`);
    await queryRunner.query(`DROP TYPE user_role`);
  }
}
