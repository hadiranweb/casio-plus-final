import { createHash } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface Migration {
  version: string;
  sql: string;
}

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl.trim()) {
    throw new Error('DATABASE_URL must be configured');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 16),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  values: unknown[],
): Promise<T | null> {
  const result = await pool.query<T>(text, values);
  return result.rows[0] ?? null;
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function applyMigrations(pool: Pool, migrations: Migration[]): Promise<void> {
  const sorted = [...migrations].sort((left, right) => left.version.localeCompare(right.version));
  if (sorted.length === 0) {
    throw new Error('At least one migration is required');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

  for (const migration of sorted) {
    const expectedChecksum = checksum(migration.sql);
    await withTransaction(pool, async (client) => {
      const existing = await client.query<{ checksum: string | null }>(
        'SELECT checksum FROM schema_migrations WHERE version = $1 FOR UPDATE',
        [migration.version],
      );
      if (existing.rowCount === 1) {
        const recordedChecksum = existing.rows[0]?.checksum;
        if (recordedChecksum && recordedChecksum !== expectedChecksum) {
          throw new Error(`Migration checksum mismatch for ${migration.version}`);
        }
        if (!recordedChecksum) {
          await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [
            migration.version,
            expectedChecksum,
          ]);
        }
        return;
      }

      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        expectedChecksum,
      ]);
    });
  }
}
