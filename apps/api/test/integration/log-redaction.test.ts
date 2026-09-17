import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';

const API_ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(API_ROOT, 'dist', 'main.js');
const PORT = 3987;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the API did not become healthy');
}

/**
 * S-21. The redaction that matters is the one the running process performs, so this test drives
 * the built server and reads its actual stdout — asserting on the pino configuration instead
 * would pass even if the logger were never wired up.
 */
describe('request logs', () => {
  let api: ChildProcessWithoutNullStreams;
  let output = '';

  beforeAll(async () => {
    if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing — run \`pnpm --filter @pallet/api build\` first`);
    await resetDatabase();

    api = spawn(process.execPath, [ENTRY], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: String(PORT),
        DATABASE_URL: process.env.DATABASE_TEST_URL ?? '',
        LOG_LEVEL: 'info',
        COOKIE_SECURE: 'false',
        TRUST_PROXY_SUBNET: 'loopback',
      },
    });
    api.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    api.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    await waitForHealth();
  }, 60_000);

  afterAll(async () => {
    api.kill('SIGTERM');
    await disconnectDatabase();
  });

  it('records the request but neither the password nor the refresh cookie', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pallet-web' },
      body: JSON.stringify({ username: TEST_ADMIN.username, password: TEST_ADMIN.password }),
    });
    expect(response.status).toBe(200);

    const cookie = response.headers.get('set-cookie') ?? '';
    const tokenValue = /pallet_rt=([^;]+)/.exec(cookie)?.[1];
    expect(tokenValue).toBeTruthy();

    // Give pino a moment to flush the completed request.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(output).toContain('/api/auth/login');
    // The request line still says who called: the address Express resolved behind `trust proxy`.
    expect(output).toMatch(/"method":"POST","url":"\/api\/auth\/login","ip":"(::ffff:)?127\.0\.0\.1"/);
    expect(output).not.toContain(TEST_ADMIN.password);
    expect(output).not.toContain(tokenValue);
    expect(output.toLowerCase()).not.toContain('set-cookie');
  });

  it('keeps the path of a request but not its query string — a search is a customer name or phone (D8)', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/customers?q=Karwan-Aziz-0750`);
    expect(response.status).toBe(401);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(output).toContain('/api/customers');
    expect(output).not.toContain('Karwan-Aziz-0750');
  });
});
