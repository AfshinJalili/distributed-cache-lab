import type { MigrationInterface, QueryRunner } from 'typeorm'

export class Init1760000000000 implements MigrationInterface {
  name = 'Init1760000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE resources (
        key varchar(80) PRIMARY KEY,
        kind varchar(40) NOT NULL,
        document jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await queryRunner.query(`
      CREATE TABLE cache_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_key varchar(80) NOT NULL,
        write_policy varchar(30) NOT NULL,
        version integer NOT NULL,
        payload jsonb NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await queryRunner.query(`
      CREATE INDEX cache_outbox_pending_idx
      ON cache_outbox (next_attempt_at, created_at)
      WHERE status = 'pending'
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS cache_outbox')
    await queryRunner.query('DROP TABLE IF EXISTS resources')
  }
}
