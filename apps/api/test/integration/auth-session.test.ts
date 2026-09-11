import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { CSRF_HEADER, asUser, login, refreshCookie } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

const START = new Date('2026-09-12T08:00:00Z');
const clock = new FixedClock(START);

describe('refresh token rotation', () => {
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
    clock.set(START);
    await resetDatabase();
  });

  const refresh = (cookie: string): request.Test =>
    request(app.getHttpServer()).post('/api/auth/refresh').set(CSRF_HEADER).set('Cookie', cookie);

  it('S-4: rotates the token and leaves exactly one active token per family', async () => {
    const session = await login(app);
    const response = await refresh(session.cookie).expect(200);
    const rotated = refreshCookie(response);

    expect(rotated).not.toBe(session.cookie);

    const tokens = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(tokens.map((token) => token.status)).toEqual(['ROTATED', 'ACTIVE']);
    expect(tokens.filter((token) => token.status === 'ACTIVE')).toHaveLength(1);
  });

  it('S-5: accepts the previous token inside the 30 second grace window', async () => {
    const session = await login(app);
    const first = refreshCookie(await refresh(session.cookie).expect(200));

    clock.advance(10_000);
    const second = refreshCookie(await refresh(session.cookie).expect(200));

    expect(second).not.toBe(first);
    const family = await prisma.sessionFamily.findFirstOrThrow();
    expect(family.revokedAt).toBeNull();

    const tokens = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    // The token issued by the first call is retired in favour of the newest one.
    expect(tokens.map((token) => token.status)).toEqual(['ROTATED', 'RETIRED', 'ACTIVE']);
    expect(await prisma.auditLog.count({ where: { action: 'SESSION_REUSE_DETECTED' } })).toBe(0);
  });

  it('S-6: treats the previous token after the window as reuse and kills the family', async () => {
    const session = await login(app);
    const latest = refreshCookie(await refresh(session.cookie).expect(200));

    clock.advance(31_000);
    await refresh(session.cookie).expect(401);

    const family = await prisma.sessionFamily.findFirstOrThrow();
    expect(family.revokedReason).toBe('REUSE_DETECTED');
    expect(await prisma.refreshToken.count({ where: { status: { not: 'REVOKED' } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'SESSION_REUSE_DETECTED' } })).toBe(1);

    // Even the token that was legitimately issued last is dead now.
    await refresh(latest).expect(401);
  });

  it('S-7: treats an older rotated token as reuse', async () => {
    const session = await login(app);
    clock.advance(31_000);
    const second = refreshCookie(await refresh(session.cookie).expect(200));
    clock.advance(31_000);
    await refresh(second).expect(200);
    clock.advance(31_000);

    await refresh(session.cookie).expect(401);
    expect((await prisma.sessionFamily.findFirstOrThrow()).revokedReason).toBe('REUSE_DETECTED');
  });

  it('S-8: refuses a token past its sliding lifetime and a family past its absolute one', async () => {
    const session = await login(app);

    clock.advance(15 * 24 * 60 * 60 * 1000);
    await refresh(session.cookie).expect(401);

    // A family that is rotated regularly still dies 30 days after it was created.
    await resetDatabase();
    clock.set(START);
    let cookie = (await login(app)).cookie;
    for (let day = 0; day < 31; day++) {
      clock.advance(24 * 60 * 60 * 1000);
      const response = await refresh(cookie);
      if (response.status === 401) break;
      cookie = refreshCookie(response);
    }
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('S-9: logout revokes only its own family; logout-all revokes every session', async () => {
    const first = await login(app);
    const second = await login(app);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(CSRF_HEADER)
      .set('Cookie', first.cookie)
      .expect(204);

    expect(await prisma.sessionFamily.count({ where: { revokedAt: { not: null } } })).toBe(1);
    await refresh(first.cookie).expect(401);
    await refresh(second.cookie).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);

    const third = await login(app);
    await request(app.getHttpServer()).post('/api/auth/logout-all').set(asUser(third)).expect(204);

    expect(await prisma.sessionFamily.count({ where: { revokedAt: null } })).toBe(0);
    // The access token issued before the logout no longer works: token_version moved on.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${third.accessToken}`)
      .expect(401)
      .expect(({ body }) => expect((body as { error: { code: string } }).error.code).toBe('AUTH_TOKEN_INVALID'));
  });
});
