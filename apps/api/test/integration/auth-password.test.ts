import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { PasswordChangeGuard } from '../../src/common/guards/password-change.guard';
import { PasswordService } from '../../src/modules/auth/password.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, asUser, login } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';

const NEW_PASSWORD = 'a-considered-new-password';

/** Minimal context: the guard reads only the method, the path and `req.auth`. */
function contextFor(method: string, path: string, mustChangePassword: boolean): ExecutionContext {
  const req = { method, baseUrl: '', path, auth: { mustChangePassword } };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('change password', () => {
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

  const changePassword = (session: { accessToken: string }, body: Record<string, string>): request.Test =>
    request(app.getHttpServer()).post('/api/auth/change-password').set(asUser(session)).send(body);

  it('S-10: returns a working access token and cookie in the same response', async () => {
    const session = await login(app);

    const response = await changePassword(session, {
      currentPassword: TEST_ADMIN.password,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    const body = response.body as { accessToken: string; user: { mustChangePassword: boolean } };
    expect(body.user.mustChangePassword).toBe(false);

    // The tab that changed the password stays signed in...
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    // ...while every session that existed before it is gone.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    expect(await prisma.sessionFamily.count({ where: { revokedReason: 'PASSWORD_CHANGED' } })).toBe(1);
    await login(app, TEST_ADMIN.username, NEW_PASSWORD);
  });

  it('refuses a wrong current password, a common one, and the current one again', async () => {
    const session = await login(app);
    const cases: [Record<string, string>, string][] = [
      [{ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD }, 'CURRENT_PASSWORD_INCORRECT'],
      [{ currentPassword: TEST_ADMIN.password, newPassword: 'short' }, 'PASSWORD_TOO_SHORT'],
      [{ currentPassword: TEST_ADMIN.password, newPassword: 'x'.repeat(129) }, 'PASSWORD_TOO_LONG'],
      [{ currentPassword: TEST_ADMIN.password, newPassword: 'password123' }, 'PASSWORD_TOO_COMMON'],
      [{ currentPassword: TEST_ADMIN.password, newPassword: TEST_ADMIN.password }, 'PASSWORD_SAME_AS_CURRENT'],
    ];

    for (const [body, code] of cases) {
      const response = await changePassword(session, body).expect(400);
      expect((response.body as { error: { code: string } }).error.code, JSON.stringify(body)).toBe(code);
    }
  });
});

describe('must-change-password gate (S-16)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await app.get(PrismaService).user.update({
      where: { username: TEST_ADMIN.username },
      data: { mustChangePassword: true },
    });
  });

  it('still allows every route of the allow-list', async () => {
    const session = await login(app);

    await request(app.getHttpServer()).get('/api/auth/me').set(asUser(session)).expect(200);
    await request(app.getHttpServer()).post('/api/auth/logout-all').set(asUser(session)).expect(204);
  });

  it('refuses a route outside the allow-list', () => {
    // Every route this milestone has is on the allow-list, so the guard is exercised directly;
    // 1c re-asserts it end to end against /api/users, the first gated route to exist.
    const guard = new PasswordChangeGuard();

    expect(() => guard.canActivate(contextFor('GET', '/api/users', true))).toThrow('PASSWORD_CHANGE_REQUIRED');
    // Express routing is non-strict, so the slashed URL reaches the same handler: if the guard
    // did not normalise it, a user could never reach the one route that clears the flag.
    expect(guard.canActivate(contextFor('POST', '/api/auth/change-password/', true))).toBe(true);
    expect(guard.canActivate(contextFor('GET', '/api/auth/me', true))).toBe(true);
    expect(guard.canActivate(contextFor('GET', '/api/users', false))).toBe(true);
  });

  it('lets the user through once the password is changed', async () => {
    const session = await login(app);

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(asUser(session))
      .set(CSRF_HEADER)
      .send({ currentPassword: TEST_ADMIN.password, newPassword: NEW_PASSWORD })
      .expect(200);

    const after = await login(app, TEST_ADMIN.username, NEW_PASSWORD);
    const me = await request(app.getHttpServer()).get('/api/auth/me').set(asUser(after)).expect(200);
    expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
  });

  it('hashes with the production parameters', async () => {
    const passwords = app.get(PasswordService);
    const hash = await passwords.hash(NEW_PASSWORD);

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(passwords.needsRehash(hash)).toBe(false);
  });
});
