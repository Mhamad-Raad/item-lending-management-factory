import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { login } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

const START = new Date('2026-09-12T08:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const clock = new FixedClock(START);

describe('maintenance purges', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let maintenance: MaintenanceService;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    prisma = app.get(PrismaService);
    maintenance = app.get(MaintenanceService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    clock.set(START);
    await resetDatabase();
  });

  it('forgets a locked-out pair after a day, so its backoff starts over', async () => {
    // `updatedAt` is pinned: Prisma would otherwise stamp it from the wall clock, which the fixed
    // clock of this test has no relation to.
    await prisma.loginThrottle.create({
      data: { ip: '203.0.113.5', username: 'admin', windowStartedAt: START, lockoutCount: 3, updatedAt: START },
    });
    expect(await maintenance.purgeLoginThrottles()).toBe(0);

    clock.advance(DAY_MS + 1);
    expect(await maintenance.purgeLoginThrottles()).toBe(1);
    expect(await prisma.loginThrottle.count()).toBe(0);
  });

  it('runs the purges once at startup, not only after the first full interval', async () => {
    // Every deploy or restart would otherwise reset the countdown, and a daily job on an API that
    // restarts daily would never run at all.
    await prisma.loginThrottle.create({
      data: {
        ip: '203.0.113.6',
        username: 'admin',
        windowStartedAt: START,
        updatedAt: new Date(START.getTime() - 2 * DAY_MS),
      },
    });

    const restarted = await createTestApp({ clock });
    try {
      await expect.poll(() => prisma.loginThrottle.count(), { timeout: 3_000 }).toBe(0);
    } finally {
      await restarted.close();
    }
  });

  it('removes session families long past their absolute expiry, tokens with them, audit rows kept', async () => {
    await login(app);
    const family = await prisma.sessionFamily.findFirstOrThrow();
    const auditRowsBefore = await prisma.auditLog.count();

    // Still within retention: absolute expiry is 30 days out, the purge cutoff another 30 behind now.
    clock.advance(31 * DAY_MS);
    expect(await maintenance.purgeSessionFamilies()).toBe(0);

    clock.advance(30 * DAY_MS);
    expect(await maintenance.purgeSessionFamilies()).toBe(1);
    expect(await prisma.sessionFamily.findUnique({ where: { id: family.id } })).toBeNull();
    expect(await prisma.refreshToken.count({ where: { familyId: family.id } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditRowsBefore);
  });
});
