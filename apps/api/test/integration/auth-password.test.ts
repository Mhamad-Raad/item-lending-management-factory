import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { FixedClock } from '../../src/common/clock';
import { PasswordChangeGuard } from '../../src/common/guards/password-change.guard';
import { PasswordService } from '../../src/modules/auth/password.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, asUser, login } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';

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
      expect(errorCode(response.body), JSON.stringify(body)).toBe(code);
    }
  });

  it('locks the current-password check after five wrong guesses, sharing the login pair (Q69)', async () => {
    const session = await login(app);
    const wrong = { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD };

    for (let i = 0; i < 4; i++) {
      const response = await changePassword(session, wrong).expect(400);
      expect(errorCode(response.body)).toBe('CURRENT_PASSWORD_INCORRECT');
    }
    // The fifth wrong guess locks the pair and says for how long.
    const locked = await changePassword(session, wrong).expect(429);
    expect(locked.body).toMatchObject({
      error: { code: 'CURRENT_PASSWORD_LOCKED', details: { retryAfterSeconds: 60, retryAfterMinutes: 1 } },
    });

    // While locked even the right password is refused.
    await changePassword(session, { currentPassword: TEST_ADMIN.password, newPassword: NEW_PASSWORD }).expect(429);
    // The pair is the login's: signing in from the same address is locked too, and says so (Q93).
    const signIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password })
      .expect(429);
    expect(errorCode(signIn.body)).toBe('LOGIN_THROTTLED');

    const lockout = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOCKOUT' } });
    expect(lockout.summaryParams).toMatchObject({ lockedMinutes: 1, scope: 'ADDRESS' });
    // The password is unchanged.
    expect(await prisma.sessionFamily.count({ where: { revokedReason: 'PASSWORD_CHANGED' } })).toBe(0);
  });

  it('clears the pair once the current password is right', async () => {
    const session = await login(app);
    for (let i = 0; i < 4; i++) {
      await changePassword(session, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD }).expect(400);
    }
    await changePassword(session, { currentPassword: TEST_ADMIN.password, newPassword: NEW_PASSWORD }).expect(200);
    expect(await prisma.loginThrottle.count({ where: { username: TEST_ADMIN.username, NOT: { ip: '*' } } })).toBe(0);
  });
});

describe('change password on the account ceiling (Q69)', () => {
  const clock = new FixedClock(new Date('2026-09-12T08:00:00Z'));
  const KNOWN_IP = '192.0.2.100';
  const NEW_IP = '192.0.2.200';
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    clock.set(new Date('2026-09-12T08:00:00Z'));
    await resetDatabase();
  });

  const changePassword = (session: { accessToken: string }, ip: string, currentPassword: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(asUser(session))
      .set('X-Forwarded-For', ip)
      .send({ currentPassword, newPassword: NEW_PASSWORD });
  const signIn = (ip: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADER)
      .set('X-Forwarded-For', ip)
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

  it('stops a stolen token guessing from many addresses at twenty, whatever the address', async () => {
    const stolen = await login(app, TEST_ADMIN.username, TEST_ADMIN.password, { 'X-Forwarded-For': KNOWN_IP });

    // Four guesses from each of five addresses: no pair ever reaches its own five.
    for (let i = 0; i < 20; i++) {
      const response = await changePassword(stolen, `198.51.100.${Math.floor(i / 4) + 1}`, `wrong-${i}`);
      if (i < 19) {
        expect(response.status, `guess ${i + 1}`).toBe(400);
        expect(errorCode(response.body)).toBe('CURRENT_PASSWORD_INCORRECT');
      } else {
        // The twentieth reaches the account's ceiling.
        expect(response.status).toBe(429);
        expect(response.body).toMatchObject({
          error: { code: 'CURRENT_PASSWORD_LOCKED', details: { retryAfterSeconds: 300, retryAfterMinutes: 5 } },
        });
      }
    }

    // Held for everyone, the account's own address included, and even with the right password: a
    // token holder is no safer for sitting at an address that signed in before.
    for (const ip of [NEW_IP, KNOWN_IP, '198.51.100.1']) {
      const refused = await changePassword(stolen, ip, TEST_ADMIN.password).expect(429);
      expect(refused.body).toMatchObject({
        error: { code: 'CURRENT_PASSWORD_LOCKED', details: { retryAfterSeconds: 300 } },
      });
    }
    // The ceiling is the login's: new addresses cannot sign in, the account's own still can.
    await signIn(NEW_IP).expect(429);
    await signIn(KNOWN_IP).expect(200);

    const lockout = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'LOCKOUT', summaryParams: { path: ['scope'], equals: 'ACCOUNT' } },
    });
    expect(lockout.summaryParams).toMatchObject({ lockedMinutes: 5, lockoutCount: 1 });
    expect(await prisma.sessionFamily.count({ where: { revokedReason: 'PASSWORD_CHANGED' } })).toBe(0);

    // Once the hold is over the right current password works again.
    clock.advance(300_000);
    await changePassword(stolen, NEW_IP, TEST_ADMIN.password).expect(200);
  });

  it('counts change-password and login failures on the same ceiling', async () => {
    const session = await login(app, TEST_ADMIN.username, TEST_ADMIN.password, { 'X-Forwarded-For': KNOWN_IP });
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set(CSRF_HEADER)
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ username: TEST_ADMIN.username, password: `wrong-${i}` })
        .expect(401);
    }
    for (let i = 0; i < 9; i++) {
      await changePassword(session, `203.0.113.${i + 1}`, `wrong-${i}`).expect(400);
    }
    // The twentieth failure, through either door, trips it.
    await changePassword(session, '203.0.113.50', 'wrong').expect(429);
    await signIn(NEW_IP).expect(429);
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
