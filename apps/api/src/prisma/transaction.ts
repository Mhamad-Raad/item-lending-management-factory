import { Prisma, type PrismaClient } from '../generated/prisma/client';

/**
 * How every mutation opens its transaction (§6.6): READ COMMITTED, never SERIALIZABLE, because the row
 * locks of `locks.ts` do the serialising; up to 5 s to get a connection and 15 s to finish. Prisma's
 * own defaults (2 s and 5 s) would fail an operation that is only waiting its turn behind a lock.
 */
export const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 15_000,
} as const;

export function runInTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, TRANSACTION_OPTIONS);
}
