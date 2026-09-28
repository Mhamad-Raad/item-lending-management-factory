import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import type { LoginThrottle, Prisma } from '../../generated/prisma/client';
import {
  ACCOUNT_FAILURE_WINDOW_MS,
  ACCOUNT_MAX_FAILURES,
  ACCOUNT_MIN_DISTINCT_ADDRESSES,
  ACCOUNT_THROTTLE_IP,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_MAX_FAILURES,
  accountThrottleDurationMs,
  lockoutDurationMs,
} from './auth.constants';

export interface LockoutResult {
  /** Set when this failure crossed the threshold, for the LOCKOUT audit row. */
  lockedMinutes: number | null;
  lockoutCount: number;
}

/**
 * Failed logins are counted per (ip, username) pair, never per username alone — otherwise anyone
 * could lock a colleague out by guessing at their name (§6.8.2). The account-wide row (ip `*`, Q68)
 * only ever holds back addresses the account has never signed in from.
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
  registerFailure(tx: Prisma.TransactionClient, row: LoginThrottle): Promise<LockoutResult> {
    return this.countFailure(tx, row, LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES, lockoutDurationMs);
  }

  /**
   * The account-wide row of `username` (ip `*`), locked like a pair's. Callers lock it after the
   * pair and before the user row, always in that order.
   */
  lockAccount(tx: Prisma.TransactionClient, username: string): Promise<LoginThrottle> {
    return this.lock(tx, ACCOUNT_THROTTLE_IP, username);
  }

  /** Whole seconds until a pair's lock or an account's ceiling lifts, or `null` when the row is open. */
  retryAfterSeconds(row: LoginThrottle): number | null {
    if (!this.isLocked(row) || !row.lockedUntil) return null;
    return Math.max(1, Math.ceil((row.lockedUntil.getTime() - this.clock.now().getTime()) / 1000));
  }

  /**
   * Whether `ip` has signed in to the account before: a session family was opened from it and is
   * still kept (§6.8.2 keeps them 30 days past their absolute expiry). The ceiling never applies to it.
   */
  async isKnownAddress(tx: Prisma.TransactionClient, userId: number, ip: string): Promise<boolean> {
    const family = await tx.sessionFamily.findFirst({ where: { userId, createdIp: ip }, select: { id: true } });
    return family !== null;
  }

  /**
   * What stands in for "has this address signed in to the account before?" when the typed username has no
   * account (Q122): whether it has signed in to any account. Answering an unknown username as an unknown
   * address everywhere would tell someone at the factory — an address every real account knows — which names
   * exist, since the real ones would let them try. This way the factory's address, and any other address
   * people sign in from, gets the same answer for a real and an invented name.
   */
  async isAddressKnownToAnyAccount(tx: Prisma.TransactionClient, ip: string): Promise<boolean> {
    const family = await tx.sessionFamily.findFirst({ where: { createdIp: ip }, select: { id: true } });
    return family !== null;
  }

  /**
   * Counts one failure against the account from any address; at the ceiling, holds back unknown
   * addresses with a doubling delay. The count restarts after the window or a hold.
   */
  async registerAccountFailure(tx: Prisma.TransactionClient, row: LoginThrottle): Promise<LockoutResult> {
    const addresses = await this.failingAddresses(tx, row.username);
    return this.countFailure(tx, row, ACCOUNT_FAILURE_WINDOW_MS, ACCOUNT_MAX_FAILURES, accountThrottleDurationMs, {
      mayLock: addresses >= ACCOUNT_MIN_DISTINCT_ADDRESSES,
    });
  }

  /**
   * How many addresses have failed at `username` within the account's window (Q122): its pair rows with a
   * failure or a lock whose last failure (`updated_at`, written from the injected clock by `countFailure`)
   * falls inside it. The caller's own failure has been counted on its pair already.
   */
  private async failingAddresses(tx: Prisma.TransactionClient, username: string): Promise<number> {
    const since = new Date(this.clock.now().getTime() - ACCOUNT_FAILURE_WINDOW_MS);
    return tx.loginThrottle.count({
      where: {
        username,
        ip: { not: ACCOUNT_THROTTLE_IP },
        updatedAt: { gt: since },
        OR: [{ failureCount: { gt: 0 } }, { lockedUntil: { not: null } }],
      },
    });
  }

  /** A successful login clears the pair's history, including its backoff. */
  async clear(tx: Prisma.TransactionClient, ip: string, username: string): Promise<void> {
    await tx.loginThrottle.deleteMany({ where: { ip, username } });
  }

  private async countFailure(
    tx: Prisma.TransactionClient,
    row: LoginThrottle,
    windowMs: number,
    maxFailures: number,
    durationMs: (lockoutCount: number) => number,
    { mayLock }: { mayLock: boolean } = { mayLock: true },
  ): Promise<LockoutResult> {
    const now = this.clock.now();
    const where = { ip_username: { ip: row.ip, username: row.username } };
    const windowExpired = now.getTime() - row.windowStartedAt.getTime() > windowMs;
    const failureCount = windowExpired ? 1 : row.failureCount + 1;

    // `updatedAt` is set here from the injected clock rather than left to Prisma's wall clock: it is when this
    // row last failed, which `failingAddresses` compares against the same clock. Short of the threshold — or at
    // it while the lock is not allowed yet — the count grows and the lock waits for the next failure.
    if (failureCount < maxFailures || !mayLock) {
      await tx.loginThrottle.update({
        where,
        data: { failureCount, windowStartedAt: windowExpired ? now : row.windowStartedAt, updatedAt: now },
      });
      return { lockedMinutes: null, lockoutCount: row.lockoutCount };
    }

    const lockMs = durationMs(row.lockoutCount);
    await tx.loginThrottle.update({
      where,
      data: {
        failureCount: 0,
        windowStartedAt: now,
        lockedUntil: new Date(now.getTime() + lockMs),
        lockoutCount: row.lockoutCount + 1,
        updatedAt: now,
      },
    });
    return { lockedMinutes: lockMs / 60_000, lockoutCount: row.lockoutCount + 1 };
  }
}
