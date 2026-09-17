/**
 * The live suite's API (§14.6, Q63), started by Playwright before any test:
 *   1. migrations and grants on the test database   (dist/scripts/migrate.js, as the owner role)
 *   2. every table emptied, one admin put back      (dist/scripts/e2e-reset.js — refuses a non-*_test database)
 *   3. the deterministic demo data                  (dist/scripts/seed-demo.js — two months up to today)
 *   4. the API itself                               (dist/main.js), until Playwright stops it
 *
 * Needs the API built (`pnpm --filter @pallet/api build`) and `DATABASE_TEST_URL` / `DATABASE_TEST_MIGRATE_URL`,
 * from the environment (CI) or the repository's `.env` (local).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const api = path.join(root, 'apps', 'api');

const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides what the environment already sets

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`[live-api] ${name} is required (the test database)`);
  return value;
};

const entry = path.join(api, 'dist', 'main.js');
if (!existsSync(entry))
  throw new Error(`[live-api] ${entry} is missing: run \`pnpm --filter @pallet/api build\` first`);

// The test database, both roles, whatever the development `.env` names for everyday use.
const env = {
  ...process.env,
  NODE_ENV: 'test',
  API_PORT: need('LIVE_API_PORT'),
  DATABASE_URL: need('DATABASE_TEST_URL'),
  DATABASE_MIGRATE_URL: need('DATABASE_TEST_MIGRATE_URL'),
  JWT_ACCESS_SECRET: 'live-e2e-only-secret-live-e2e-only-secret-live-e2e-only-secret-00',
  COOKIE_SECURE: 'false',
  TRUST_PROXY_SUBNET: 'loopback',
  UPLOADS_DIR: path.join(tmpdir(), 'pallet-live-e2e-uploads'),
  LOG_LEVEL: 'warn',
  ADMIN_USERNAME: need('LIVE_ADMIN_USERNAME'),
  ADMIN_DISPLAY_NAME: need('LIVE_ADMIN_DISPLAY_NAME'),
  ADMIN_PASSWORD: need('LIVE_ADMIN_PASSWORD'),
  SENTRY_DSN: '',
};

// Before anything is reset: a port held by something else would fail the API only after the seed had run.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error(`[live-api] port ${env.API_PORT} is in use; free it first`)));
  probe.listen(Number(env.API_PORT), () => probe.close(resolve));
});

for (const script of ['migrate.js', 'e2e-reset.js', 'seed-demo.js']) {
  const result = spawnSync(process.execPath, ['--enable-source-maps', path.join(api, 'dist', 'scripts', script)], {
    cwd: api,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`[live-api] ${script} failed (exit ${result.status})`);
}

const server = spawn(process.execPath, ['--enable-source-maps', entry], { cwd: api, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
