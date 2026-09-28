import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PasswordService } from '../../src/modules/auth/password.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, login } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';

const clock = new FixedClock(new Date('2026-09-12T08:00:00Z'));
const IP_A = '203.0.113.1';
const IP_B = '203.0.113.2';

function attempt(app: INestApplication, body: { username: string; password: string }, ip = IP_A): request.Test {
  return request(app.getHttpServer()).post('/api/auth/login').set(CSRF_HEADER).set('X-Forwarded-For', ip).send(body);
}

describe('login', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ clock });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    clock.set(new Date('2026-09-12T08:00:00Z'));
    await resetDatabase();
  });

  it('S-1: answers identically for every kind of failure outside a lock, verifying exactly one hash each time', async () => {
    const passwords = app.get(PasswordService);
    const prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        username: 'inactive',
        displayName: 'Inactive',
        passwordHash: await passwords.hash('inactive-password'),
        role: 'EMPLOYEE',
        isActive: false,
        mustChangePassword: false,
      },
    });

    const cases = [
      { username: 'nobody', password: TEST_ADMIN.password },
      { username: TEST_ADMIN.username, password: 'wrong-password' },
      { username: 'inactive', password: 'inactive-password' },
    ];

    const bodies: unknown[] = [];
    for (const body of cases) {
      const verify = vi.spyOn(passwords, 'verify');
      const verifyDummy = vi.spyOn(passwords, 'verifyDummy');

      const response = await attempt(app, body).expect(401);
      bodies.push({ ...(response.body as { error: unknown; requestId: string }), requestId: undefined });

      // Exactly one Argon2 verification per attempt: response time must not reveal the reason.
      expect(verify.mock.calls.length + verifyDummy.mock.calls.length).toBe(1);
      vi.restoreAllMocks();
    }

    expect(bodies[0]).toEqual({ error: { code: 'AUTH_INVALID_CREDENTIALS' }, requestId: undefined });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('S-2: locks the (ip, username) pair after five failures, and only that pair, saying how long', async () => {
    for (let i = 0; i < 4; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);

    // The fifth failure locks the pair, and its answer already names the wait (Q93).
    const locking = await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(429);
    expect(locking.body).toMatchObject({
      error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: 60, retryAfterMinutes: 1 } },
    });

    // The correct password is refused while the pair is locked, with the time left.
    clock.advance(15_000);
    const refused = await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }).expect(429);
    expect(refused.body).toMatchObject({
      error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: 45, retryAfterMinutes: 1 } },
    });

    // The same account from another address, and another account from the locked address, are fine.
    await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, IP_B).expect(200);

    const prisma = app.get(PrismaService);
    const lockout = await prisma.auditLog.findFirst({ where: { action: 'LOCKOUT' } });
    expect(lockout).toMatchObject({ ip: IP_A, usernameAttempt: TEST_ADMIN.username });
    expect(lockout?.summaryParams).toMatchObject({ lockedMinutes: 1, scope: 'ADDRESS' });
    // The attempt during the lock is still recorded as such.
    const locked = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'LOGIN_FAILURE', summaryParams: { path: ['reason'], equals: 'LOCKED' } },
    });
    expect(locked).toMatchObject({ ip: IP_A, usernameAttempt: TEST_ADMIN.username });
  });

  it('S-2: backs the lockout off, and a success clears the pair', async () => {
    const prisma = app.get(PrismaService);
    const fail = async (minutes: number): Promise<void> => {
      for (let i = 0; i < 4; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);
      const locking = await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(429);
      expect(locking.body).toMatchObject({
        error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: minutes * 60, retryAfterMinutes: minutes } },
      });
    };

    await fail(1);
    clock.advance(61_000);
    await fail(2);

    const throttle = await prisma.loginThrottle.findUniqueOrThrow({
      where: { ip_username: { ip: IP_A, username: TEST_ADMIN.username } },
    });
    // 1 minute, then 2: lock durations double until they reach 15 minutes.
    expect(throttle.lockoutCount).toBe(2);
    expect(throttle.lockedUntil?.getTime()).toBe(clock.now().getTime() + 120_000);

    clock.advance(121_000);
    await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }).expect(200);

    expect(
      await prisma.loginThrottle.findUnique({ where: { ip_username: { ip: IP_A, username: TEST_ADMIN.username } } }),
    ).toBeNull();
  });

  describe('the pair lock names its wait without revealing anything (Q93)', () => {
    /** Each attempt's body without its request id, and how many Argon2 verifications it ran. */
    const probe = async (
      body: { username: string; password: string },
      status: number,
    ): Promise<{ body: unknown; verifications: number; realVerifications: number }> => {
      const passwords = app.get(PasswordService);
      const verify = vi.spyOn(passwords, 'verify');
      const verifyDummy = vi.spyOn(passwords, 'verifyDummy');
      try {
        const response = await attempt(app, body).expect(status);
        return {
          body: { ...(response.body as { error: unknown; requestId: string }), requestId: undefined },
          verifications: verify.mock.calls.length + verifyDummy.mock.calls.length,
          realVerifications: verify.mock.calls.length,
        };
      } finally {
        vi.restoreAllMocks();
      }
    };

    it('answers an unknown username exactly as an existing one, from the locking failure on', async () => {
      const existing: unknown[] = [];
      const unknown: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const status = i < 4 ? 401 : 429;
        existing.push((await probe({ username: TEST_ADMIN.username, password: 'wrong' }, status)).body);
        unknown.push((await probe({ username: 'nobody-here', password: 'wrong' }, status)).body);
      }
      // Locked: the right password for the admin, anything for the name nobody has.
      existing.push((await probe({ username: TEST_ADMIN.username, password: TEST_ADMIN.password }, 429)).body);
      unknown.push((await probe({ username: 'nobody-here', password: TEST_ADMIN.password }, 429)).body);

      expect(unknown).toEqual(existing);
      expect(existing[4]).toEqual({
        error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: 60, retryAfterMinutes: 1 } },
        requestId: undefined,
      });
      expect(existing[5]).toEqual(existing[4]);

      // Both locks are recorded, the unknown name's without a user.
      const prisma = app.get(PrismaService);
      const lockouts = await prisma.auditLog.findMany({ where: { action: 'LOCKOUT' }, orderBy: { id: 'asc' } });
      expect(lockouts.map((row) => [row.usernameAttempt, row.userId === null])).toEqual([
        [TEST_ADMIN.username, false],
        ['nobody-here', true],
      ]);
    });

    it('answers a right and a wrong password identically while locked, each after one dummy verification', async () => {
      for (let i = 0; i < 4; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);
      const locking = await probe({ username: TEST_ADMIN.username, password: 'wrong' }, 429);
      // The locking failure verified the real hash, once, as any wrong password does.
      expect(locking).toMatchObject({ verifications: 1, realVerifications: 1 });

      const right = await probe({ username: TEST_ADMIN.username, password: TEST_ADMIN.password }, 429);
      const wrong = await probe({ username: TEST_ADMIN.username, password: 'still-wrong' }, 429);

      expect(right.body).toEqual(wrong.body);
      expect(right.body).toEqual(locking.body);
      // One verification each, against the dummy hash: the time taken cannot tell the password apart.
      expect(right).toMatchObject({ verifications: 1, realVerifications: 0 });
      expect(wrong).toMatchObject({ verifications: 1, realVerifications: 0 });

      const prisma = app.get(PrismaService);
      expect(
        await prisma.auditLog.count({
          where: { action: 'LOGIN_FAILURE', summaryParams: { path: ['reason'], equals: 'LOCKED' } },
        }),
      ).toBe(2);
    });

    it('answers the pair’s wait when the account’s ceiling also holds', async () => {
      // Five failures lock this address's pair for a minute; fifteen more from elsewhere reach the ceiling.
      for (let i = 0; i < 4; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);
      await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(429);
      for (let i = 0; i < 15; i++) {
        await attempt(app, { username: TEST_ADMIN.username, password: `wrong-${i}` }, `198.51.100.${i + 1}`).expect(
          401,
        );
      }
      const prisma = app.get(PrismaService);
      expect(
        await prisma.auditLog.count({
          where: { action: 'LOCKOUT', summaryParams: { path: ['scope'], equals: 'ACCOUNT' } },
        }),
      ).toBe(1);

      // The pair is checked first, so its one-minute wait is the answer, not the ceiling's five.
      const refused = await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }).expect(429);
      expect(refused.body).toMatchObject({
        error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: 60, retryAfterMinutes: 1 } },
      });

      // Once the pair opens, the ceiling still holds this address back with its own code.
      clock.advance(61_000);
      const held = await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }).expect(429);
      expect(held.body).toMatchObject({ error: { code: 'LOGIN_ACCOUNT_THROTTLED' } });
    });
  });

  describe('account-wide ceiling (Q68)', () => {
    /** One wrong guess from each of `count` addresses, so no single pair ever locks. */
    const spreadFailures = async (username: string, count: number, from = 0): Promise<void> => {
      for (let i = from; i < from + count; i++) {
        await attempt(app, { username, password: `wrong-${i}` }, `198.51.100.${i + 1}`).expect(401);
      }
    };
    const NEW_IP = '192.0.2.200';
    const KNOWN_IP = '192.0.2.100';

    it('holds back new addresses after twenty failures from many, but never the account’s own devices', async () => {
      // The admin has signed in from KNOWN_IP before the attack.
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, KNOWN_IP).expect(200);

      await spreadFailures(TEST_ADMIN.username, 19);
      // Nineteen failures: still open to everyone.
      await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }, NEW_IP).expect(401);

      // The twentieth crossed the ceiling. Even the right password from a new address is held back,
      // with a code that says how long to wait — the answer does not depend on the password.
      for (const password of [TEST_ADMIN.password, 'still-wrong']) {
        const refused = await attempt(app, { username: TEST_ADMIN.username, password }, '192.0.2.201').expect(429);
        expect(refused.body).toMatchObject({
          error: { code: 'LOGIN_ACCOUNT_THROTTLED', details: { retryAfterSeconds: 300, retryAfterMinutes: 5 } },
        });
      }

      // The colleague at their usual device is not locked out.
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, KNOWN_IP).expect(200);

      const prisma = app.get(PrismaService);
      const lockout = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'LOCKOUT', summaryParams: { path: ['scope'], equals: 'ACCOUNT' } },
      });
      expect(lockout).toMatchObject({ usernameAttempt: TEST_ADMIN.username });
      expect(lockout.summaryParams).toMatchObject({ lockedMinutes: 5, lockoutCount: 1 });
      expect(
        await prisma.auditLog.count({
          where: { action: 'LOGIN_FAILURE', summaryParams: { path: ['reason'], equals: 'ACCOUNT_THROTTLED' } },
        }),
      ).toBe(2);

      // Five minutes later new addresses may try again.
      clock.advance(300_000);
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, '192.0.2.202').expect(200);
    });

    it('doubles the hold each time the ceiling is reached again', async () => {
      await spreadFailures(TEST_ADMIN.username, 20);
      clock.advance(300_000);
      await spreadFailures(TEST_ADMIN.username, 20, 20);

      const refused = await attempt(app, { username: TEST_ADMIN.username, password: 'x' }, NEW_IP).expect(429);
      expect(refused.body).toMatchObject({ error: { details: { retryAfterSeconds: 600, retryAfterMinutes: 10 } } });
    });

    it('answers an unknown username the same way, so the ceiling reveals no account', async () => {
      await spreadFailures('nobody-here', 20);
      const refused = await attempt(app, { username: 'nobody-here', password: 'x' }, NEW_IP).expect(429);
      expect(refused.body).toMatchObject({
        error: { code: 'LOGIN_ACCOUNT_THROTTLED', details: { retryAfterSeconds: 300, retryAfterMinutes: 5 } },
      });
    });

    it('Q122: is not reached by one or two addresses alone, however many failures they make', async () => {
      // Their own addresses: the in-memory `login` throttler (60 a minute) outlives the reset between tests.
      const LONE_IP = '203.0.113.50';
      const SECOND_IP = '203.0.113.51';
      // One address makes twenty failures within the hour, waiting out each of its pair locks (1, 2, 4, 8 min).
      for (let lock = 0; lock < 4; lock++) {
        for (let i = 0; i < 4; i++)
          await attempt(app, { username: TEST_ADMIN.username, password: 'x' }, LONE_IP).expect(401);
        await attempt(app, { username: TEST_ADMIN.username, password: 'x' }, LONE_IP).expect(429);
        clock.advance(2 ** lock * 60_000 + 1_000);
      }
      // A second address adds more; the account still has no ceiling, so a new address signs in.
      for (let i = 0; i < 4; i++)
        await attempt(app, { username: TEST_ADMIN.username, password: 'x' }, SECOND_IP).expect(401);
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, NEW_IP).expect(200);

      const prisma = app.get(PrismaService);
      const scope = { action: 'LOCKOUT' as const, summaryParams: { path: ['scope'], equals: 'ACCOUNT' } };
      expect(await prisma.auditLog.count({ where: scope })).toBe(0);

      // A third address failing brings the count, already past twenty, to the ceiling at once.
      await attempt(app, { username: TEST_ADMIN.username, password: 'x' }, '198.51.100.77').expect(401);
      expect(await prisma.auditLog.count({ where: scope })).toBe(1);
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, '192.0.2.203').expect(429);
    });

    describe('Q122: under a holding ceiling an unknown username answers as an existing one would', () => {
      /** The body without its request id, and how many verifications it ran. */
      const probe = async (username: string, ip: string, status: number) => {
        const passwords = app.get(PasswordService);
        const verify = vi.spyOn(passwords, 'verify');
        const verifyDummy = vi.spyOn(passwords, 'verifyDummy');
        try {
          const response = await attempt(app, { username, password: 'wrong-guess' }, ip).expect(status);
          return {
            body: { ...(response.body as object), requestId: undefined },
            verifications: verify.mock.calls.length + verifyDummy.mock.calls.length,
          };
        } finally {
          vi.restoreAllMocks();
        }
      };

      beforeEach(async () => {
        // The admin signs in from KNOWN_IP (the factory's address), then both names reach their ceilings.
        await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, KNOWN_IP).expect(200);
        await spreadFailures(TEST_ADMIN.username, 20);
        await spreadFailures('nobody-here', 20, 20);
      });

      it('from an address people sign in from: the plain wrong-password answer, one verification each', async () => {
        const real = await probe(TEST_ADMIN.username, KNOWN_IP, 401);
        const invented = await probe('nobody-here', KNOWN_IP, 401);
        expect(invented).toEqual(real);
        expect(real).toEqual({
          body: { error: { code: 'AUTH_INVALID_CREDENTIALS' }, requestId: undefined },
          verifications: 1,
        });
      });

      it('from an address nobody signed in from: the ceiling’s answer for both', async () => {
        const real = await probe(TEST_ADMIN.username, NEW_IP, 429);
        const invented = await probe('nobody-here', NEW_IP, 429);
        expect(invented).toEqual(real);
        expect(real.body).toMatchObject({ error: { code: 'LOGIN_ACCOUNT_THROTTLED' } });
        expect(real.verifications).toBe(1);
      });

      it('from the known address once its pair locks: the pair’s wait for both, from the locking failure on', async () => {
        const real: unknown[] = [];
        const invented: unknown[] = [];
        for (let i = 0; i < 6; i++) {
          const status = i < 4 ? 401 : 429;
          real.push(await probe(TEST_ADMIN.username, KNOWN_IP, status));
          invented.push(await probe('nobody-here', KNOWN_IP, status));
        }
        expect(invented).toEqual(real);
        expect(real[5]).toMatchObject({ body: { error: { code: 'LOGIN_THROTTLED' } }, verifications: 1 });
      });
    });

    it('forgets failures older than the one-hour window', async () => {
      await spreadFailures(TEST_ADMIN.username, 19);
      clock.advance(60 * 60_000 + 1_000);
      await spreadFailures(TEST_ADMIN.username, 1, 19);
      await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, NEW_IP).expect(200);
    });
  });

  it('S-17: refuses a state-changing request without the CSRF header', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password })
      .expect(403)
      .expect(({ body }) => expect(errorCode(body)).toBe('CSRF_HEADER_MISSING'));

    // GET is unaffected.
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('S-20: rejects an unknown body key with a field error', async () => {
    const response = await attempt(app, {
      username: TEST_ADMIN.username,
      password: TEST_ADMIN.password,
      ...{ remember: true },
    } as { username: string; password: string }).expect(400);

    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: [{ path: 'remember', code: 'unknown_key' }] },
    });
  });

  it('records a deactivated account as INACTIVE in the audit log, while answering the same 401', async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        username: 'retired',
        displayName: 'Retired',
        passwordHash: await app.get(PasswordService).hash('retired-password'),
        role: 'EMPLOYEE',
        isActive: false,
        mustChangePassword: false,
      },
    });

    await attempt(app, { username: 'retired', password: 'retired-password' }).expect(401);

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOGIN_FAILURE' } });
    expect(row.summaryParams).toMatchObject({ reason: 'INACTIVE' });
  });

  it('writes a session-scoped audit row on success', async () => {
    const session = await login(app);
    const prisma = app.get(PrismaService);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOGIN_SUCCESS' } });

    expect(row).toMatchObject({ entityType: 'SESSION', usernameAttempt: TEST_ADMIN.username });
    expect(row.entityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.accessToken.split('.')).toHaveLength(3);
  });
});
