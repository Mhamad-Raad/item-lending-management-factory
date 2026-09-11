import type { Prisma } from '../generated/prisma/client';

/**
 * Row locks, always taken in the order of §6.6 (customer → order → items → counter) so that two
 * transactions touching the same rows cannot deadlock by approaching them from opposite ends.
 * Each helper locks and returns nothing; the caller re-reads under the lock.
 */

/** Locks one user row; a missing user simply locks nothing. */
export async function lockUser(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

/**
 * Locks every active admin row, in id order. Taken before `lockUser` by any change that could
 * remove admin power, so that two admins demoting each other concurrently are serialised and
 * exactly one of them wins the last-admin check.
 */
export async function lockActiveAdmins(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' AND is_active = true ORDER BY id FOR UPDATE`;
}
