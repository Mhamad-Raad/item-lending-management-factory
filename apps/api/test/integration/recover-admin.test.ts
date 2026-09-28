import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecoveryRefused, recoverAdmin } from '../../src/scripts/recover-admin';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, login } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';
import { createUser } from '../helpers/factories';

const API_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(API_ROOT, 'dist', 'scripts', 'recover-admin.js');
const NEW_PASSWORD = 'recovered-temp-password-7';

/** Q130: `recover-admin` gives a locked-out admin a temporary password, as the API's own reset would. */
describe('recover-admin', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const attempt = (username: string, password: string, ip = '203.0.113.90') =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('X-Forwarded-For', ip)
      .send({ username, password });

  it('sets a temporary password, signs the user out everywhere and clears their login throttles', async () => {
    const session = await login(app);
    for (const ip of ['198.51.100.1', '198.51.100.2']) await attempt(TEST_ADMIN.username, 'wrong', ip).expect(401);
    const { tokenVersion } = await prisma.user.findUniqueOrThrow({ where: { username: TEST_ADMIN.username } });

    const result = await recoverAdmin(prisma, { username: ' ADMIN ', password: NEW_PASSWORD, promote: false });
    expect(result).toMatchObject({ role: 'ADMIN', reactivated: false, promoted: false, sessionsRevoked: 1 });

    const user = await prisma.user.findUniqueOrThrow({ where: { username: TEST_ADMIN.username } });
    expect(user).toMatchObject({ mustChangePassword: true, isActive: true, tokenVersion: tokenVersion + 1 });
    expect(await prisma.loginThrottle.count({ where: { username: TEST_ADMIN.username } })).toBe(0);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set(CSRF_HEADER)
      .set('Cookie', session.cookie)
      .expect(401);

    await attempt(TEST_ADMIN.username, TEST_ADMIN.password).expect(401);
    const signedIn = await attempt(TEST_ADMIN.username, NEW_PASSWORD).expect(200);
    expect(signedIn.body).toMatchObject({ user: { mustChangePassword: true } });

    const reset = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PASSWORD_RESET' } });
    expect(reset).toMatchObject({ userId: null, entityId: String(user.id) });
    expect(reset.summaryParams).toEqual({ username: TEST_ADMIN.username, via: 'recover-admin' });
  });

  it('with --promote, makes a deactivated employee an active admin, and records both changes', async () => {
    const clerk = await createUser(app, { username: 'clerk', isActive: false, permissions: ['orders.view'] });

    const result = await recoverAdmin(prisma, { username: 'clerk', password: NEW_PASSWORD, promote: true });
    expect(result).toMatchObject({ role: 'ADMIN', reactivated: true, promoted: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: clerk.id }, include: { permissions: true } });
    expect(user).toMatchObject({ role: 'ADMIN', isActive: true, permissions: [] });

    const actions = await prisma.auditLog.findMany({ where: { entityId: String(clerk.id) }, orderBy: { id: 'asc' } });
    expect(actions.map((row) => row.action)).toEqual(['PASSWORD_RESET', 'USER_ACTIVATE', 'PERMISSION_CHANGE']);
    expect(actions[2]).toMatchObject({
      before: { role: 'EMPLOYEE', permissions: ['orders.view'] },
      after: { role: 'ADMIN', permissions: [] },
    });
    await attempt('clerk', NEW_PASSWORD).expect(200);
  });

  it('refuses an unknown user and a password the policy refuses, writing nothing', async () => {
    const audits = await prisma.auditLog.count();
    await expect(recoverAdmin(prisma, { username: 'nobody', password: NEW_PASSWORD, promote: true })).rejects.toThrow(
      new RecoveryRefused('no user is named "nobody" (usernames are listed in the users table)'),
    );
    await expect(recoverAdmin(prisma, { username: 'admin', password: 'password123', promote: false })).rejects.toThrow(
      RecoveryRefused,
    );
    await expect(recoverAdmin(prisma, { username: 'admin', password: 'short', promote: false })).rejects.toThrow(
      'the new password is shorter than 10 characters',
    );
    expect(await prisma.auditLog.count()).toBe(audits);
    await attempt(TEST_ADMIN.username, TEST_ADMIN.password).expect(200);
  });

  it('as a command: reads the password from stdin and never takes one on the command line', () => {
    if (!existsSync(SCRIPT)) throw new Error(`${SCRIPT} is missing — run \`pnpm --filter @pallet/api build\` first`);
    const run = (args: string[], input: string) =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: API_ROOT,
        input,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_TEST_URL ?? '' },
      });

    const withArgvPassword = run([TEST_ADMIN.username, NEW_PASSWORD], '');
    expect(withArgvPassword.status).toBe(1);
    expect(withArgvPassword.stderr).toContain('usage: recover-admin.js <username> [--promote]');

    const unknown = run(['nobody'], `${NEW_PASSWORD}\n`);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('no user is named "nobody"');

    const ok = run([TEST_ADMIN.username], `${NEW_PASSWORD}\n`);
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('"admin" (ADMIN) has the new temporary password');
  });
});
