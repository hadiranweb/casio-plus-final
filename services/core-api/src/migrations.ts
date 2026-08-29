import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Migration } from './db.js';

const migrationFilePattern = /^(\d+_[a-z0-9_-]+)\.sql$/;

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory))
    .filter((file) => migrationFilePattern.test(file))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`No migration files found in ${resolve(directory)}`);
  }

  return Promise.all(
    files.map(async (file) => ({
      version: file.replace(/\.sql$/, ''),
      sql: await readFile(resolve(directory, file), 'utf8'),
    })),
  );
}
