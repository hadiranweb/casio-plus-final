import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, createPool } from '../db.js';
import { loadMigrations } from '../migrations.js';

const rootDirectory = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const migrationsDirectory = process.env.MIGRATIONS_DIR ?? resolve(rootDirectory, 'migrations');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured');
}

const pool = createPool(databaseUrl);
try {
  const migrations = await loadMigrations(migrationsDirectory);
  await applyMigrations(pool, migrations);
  console.log(
    JSON.stringify({
      status: 'migrated',
      migrationsDirectory,
      versions: migrations.map((migration) => migration.version),
    }),
  );
} finally {
  await pool.end();
}
