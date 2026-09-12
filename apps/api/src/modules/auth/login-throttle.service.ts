import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import type { LoginThrottle, Prisma } from '../../generated/prisma/client';
import { LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES, lockoutDurationMs } from './auth.constants';

export interface LockoutResult {
  /** Set when this failure crossed the threshold, for the LOCKOUT audit row. */
  lockedMinutes: number | null;
  lockoutCount: number;
}

/**
 * Failed logins are counted per (ip, username) pair, never per username alone — otherwise anyone
 * could lock a colleague out by guessing at their name (§6.8.2).
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly clock: Clock) {}

  /**
   * Creates the row if needed, locks it and returns it, so the whole check-and-count runs under
   * one lock and reads the row once. The timestamps come from the injected clock, never from SQL
   * `now()`: the window arithmetic compares them against the same clock, and two sources of time
   * make the window nonsense.
   */
  async lock(tx: Prisma.TransactionClient, ip: string, username: string): Promise<LoginThrottle> {
    const now = this.clock.now();
    // DO UPDATE rather than DO NOTHING: both wait for a conflicting uncommitted insert, but only
    // DO UPDATE leaves the row locked for this transaction, so the read-modify-write below needs
    // no second `SELECT … FOR UPDATE` round trip.
    await tx.$executeRaw`
      INSERT INTO login_throttles (ip, username, failure_count, window_started_at, lockout_count, updated_at)
      VALUES (${ip}, ${username}, 0, ${now}, 0, ${now})
      ON CONFLICT (ip, username) DO UPDATE SET ip = EXCLUDED.ip`;
    return tx.loginThrottle.findUniqueOrThrow({ where: { ip_username: { ip, username } } });
  }

  isLocked(row: LoginThrottle): boolean {
    return row.lockedUntil !== null && row.lockedUntil > this.clock.now();
  }

  /** Counts one failure and locks the pair when it reaches the threshold. */
  async registerFailure(tx: Prisma.TransactionClient, row: LoginThrottle): Promise<LockoutResult> {
    const now = this.clock.now();
    const where = { ip_username: { ip: row.ip, username: row.username } };
    const windowExpired = now.getTime() - row.windowStartedAt.getTime() > LOGIN_FAILURE_WINDOW_MS;
    const failureCount = windowExpired ? 1 : row.failureCount + 1;

    if (failureCount < LOGIN_MAX_FAILURES) {
      await tx.loginThrottle.update({
        where,
        data: { failureCount, windowStartedAt: windowExpired ? now : row.windowStartedAt },
      });
      return { lockedMinutes: null, lockoutCount: row.lockoutCount };
    }

    const durationMs = lockoutDurationMs(row.lockoutCount);
    await tx.loginThrottle.update({
      where,
      data: {
        failureCount: 0,
        windowStartedAt: now,
        lockedUntil: new Date(now.getTime() + durationMs),
        lockoutCount: row.lockoutCount + 1,
      },
    });
    return { lockedMinutes: durationMs / 60_000, lockoutCount: row.lockoutCount + 1 };
  }

  /** A successful login clears the pair's history, including its backoff. */
  async clear(tx: Prisma.TransactionClient, ip: string, username: string): Promise<void> {
    await tx.loginThrottle.deleteMany({ where: { ip, username } });
  }
}
