import { Prisma, type PrismaClient } from '../generated/prisma/client';

/** How long any transaction may wait for a pooled connection before it gives up. */
export const TRANSACTION_MAX_WAIT_MS = 5_000;

/** How long a read-only snapshot may run: a report over years of rows, bounded by the request timeout. */
export const SNAPSHOT_TIMEOUT_MS = 30_000;

/**
 * How every mutation opens its transaction (§6.6): READ COMMITTED, never SERIALIZABLE, because the row
 * locks of `locks.ts` do the serialising; up to 5 s to get a connection and 15 s to finish. Prisma's
 * own defaults (2 s and 5 s) would fail an operation that is only waiting its turn behind a lock.
 */
export const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: TRANSACTION_MAX_WAIT_MS,
  timeout: 15_000,
} as const;

export function runInTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, TRANSACTION_OPTIONS);
}

/**
 * A read made of several queries — keys, totals, then the rows' names — that must all see one moment,
 * or a row written in between would appear in one query and not the other. Read-only work, so
 * REPEATABLE READ is safe here; §4.8's "never SERIALIZABLE" concerns the writes.
 */
export function runInSnapshot<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: TRANSACTION_MAX_WAIT_MS,
    timeout: SNAPSHOT_TIMEOUT_MS,
  });
}
