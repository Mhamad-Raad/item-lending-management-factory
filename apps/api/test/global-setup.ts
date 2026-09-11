import { execFileSync } from 'node:child_process';
import path from 'node:path';

const API_ROOT = path.resolve(__dirname, '..');
const PRISMA_BIN = path.join(API_ROOT, 'node_modules', '.bin', 'prisma');

/**
 * Brings `pallet_test` to the current schema once per run, as the owner role. CI migrates the
 * `pallet` database only (`pnpm db:deploy`), so without this the suite would run against an
 * empty test database. Grants follow the migration because a new table starts with none.
 */
export default function setup(): void {
  const migrateUrl = process.env.DATABASE_TEST_MIGRATE_URL;
  if (!migrateUrl) throw new Error('DATABASE_TEST_MIGRATE_URL is required to run the integration tests');
  if (!process.env.DATABASE_TEST_URL) throw new Error('DATABASE_TEST_URL is required to run the integration tests');

  const env = { ...process.env, DATABASE_MIGRATE_URL: migrateUrl };
  const run = (args: string[]): void => {
    execFileSync(PRISMA_BIN, args, { cwd: API_ROOT, env, stdio: 'inherit' });
  };

  run(['migrate', 'deploy']);
  run(['db', 'execute', '--file', path.join('prisma', 'sql', 'grants.sql')]);
}
