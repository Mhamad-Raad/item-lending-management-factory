import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/prisma/create-client';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { disconnectDatabase, resetDatabase } from '../helpers/db';

const IP = '203.0.113.77';
const USERNAME = 'contended-pair';

function upsert(tx: { $executeRaw: PrismaClient['$executeRaw'] }, now: Date): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO login_throttles (ip, username, failure_count, window_started_at, lockout_count, updated_at)
    VALUES (${IP}, ${USERNAME}, 0, ${now}, 0, ${now})
    ON CONFLICT (ip, username) DO UPDATE SET ip = EXCLUDED.ip`;
}

/**
 * The login flow counts failures under the row lock this statement takes, and correctness depends
 * on the second attempt for a pair waiting for the first rather than racing it. The lock is the
 * contract; this test holds it in one transaction and asserts the other one blocks on it.
 */
describe('login throttle row lock', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    await resetDatabase();
    const url = process.env.DATABASE_TEST_URL ?? '';
    first = createPrismaClient(url);
    second = createPrismaClient(url);
  });

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    await disconnectDatabase();
  });

  it('makes a second transaction wait for the first', async () => {
    const now = new Date();

    await first.$transaction(async (tx) => {
      await upsert(tx, now);

      const contender = second.$transaction(async (other) => {
        await other.$executeRaw`SET LOCAL lock_timeout = '400ms'`;
        await upsert(other, now);
      });

      await expect(contender).rejects.toThrow(/lock timeout|canceling statement/i);
    });

    // Once the first transaction has committed, the row is free again.
    await expect(second.$transaction(async (other) => upsert(other, now))).resolves.toBeDefined();
  });
});
