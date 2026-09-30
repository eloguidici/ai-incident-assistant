import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { migrationSql } from './migration-files';

import { MigrationAdvisoryLockKey, MigrationId } from '../common/constants/migration';

/**
 * Applies 001_init.sql once, inside a transaction and under an advisory lock so concurrent processes do not race.
 * @param pool Connection pool for the target database.
 * @throws The database error after rolling back when the migration fails.
 */
export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MigrationAdvisoryLockKey]);
    const existing = await client.query('SELECT id FROM schema_migrations WHERE id = $1', [MigrationId.Init]);
    if (existing.rowCount) return;
    await client.query('BEGIN');
    try {
      await client.query(migrationSql('001_init.sql'));
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [MigrationId.Init]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MigrationAdvisoryLockKey]).catch(() => undefined);
    client.release();
  }
}

/**
 * Runs 001_down.sql inside a transaction and under the migration advisory lock. Callers must check for a test database first.
 * @param pool Connection pool for the target database.
 * @throws The database error after rolling back when the down script fails.
 */
export async function rollbackLatest(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MigrationAdvisoryLockKey]);
    await client.query('BEGIN');
    try {
      await client.query(migrationSql('001_down.sql'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MigrationAdvisoryLockKey]).catch(() => undefined);
    client.release();
  }
}

/**
 * Deletes every user, analysis, message, execution, and audit event. Callers must check for a test database first.
 * @param dataSource Connection for the target database.
 */
export async function truncateDomain(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE audit_events, ai_executions, messages, analyses, users RESTART IDENTITY CASCADE',
  );
}
