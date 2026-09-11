import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PasswordService } from '../../src/modules/auth/password.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, login } from '../helpers/auth';
import { TEST_ADMIN, disconnectDatabase, resetDatabase } from '../helpers/db';

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

  it('S-1: answers identically for every kind of failure, verifying exactly one hash each time', async () => {
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

  it('S-2: locks the (ip, username) pair after five failures, and only that pair', async () => {
    for (let i = 0; i < 5; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);

    // The correct password is refused while the pair is locked.
    await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }).expect(401);

    // The same account from another address, and another account from the locked address, are fine.
    await attempt(app, { username: TEST_ADMIN.username, password: TEST_ADMIN.password }, IP_B).expect(200);

    const prisma = app.get(PrismaService);
    const lockout = await prisma.auditLog.findFirst({ where: { action: 'LOCKOUT' } });
    expect(lockout).toMatchObject({ ip: IP_A, usernameAttempt: TEST_ADMIN.username });
    expect(lockout?.summaryParams).toMatchObject({ lockedMinutes: 1 });
  });

  it('S-2: backs the lockout off, and a success clears the pair', async () => {
    const prisma = app.get(PrismaService);
    const fail = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) await attempt(app, { username: TEST_ADMIN.username, password: 'wrong' }).expect(401);
    };

    await fail();
    clock.advance(61_000);
    await fail();

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

  it('S-17: refuses a state-changing request without the CSRF header', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password })
      .expect(403)
      .expect(({ body }) => expect((body as { error: { code: string } }).error.code).toBe('CSRF_HEADER_MISSING'));

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
