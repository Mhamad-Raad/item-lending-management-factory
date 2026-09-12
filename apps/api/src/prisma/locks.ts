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

/**
 * Locks the account a login names, when there is one. The same statement runs whether or not the
 * username exists, so the lock adds no timing difference between a real and an unknown account.
 */
export async function lockUserByUsername(tx: Prisma.TransactionClient, username: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE username = ${username} FOR UPDATE`;
}

/** Locks the single settings row, so two admins saving at once are checked against one version. */
export async function lockSettings(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM factory_settings WHERE id = 1 FOR UPDATE`;
}

/** Locks items in ascending id order (§4.8) — the order every transaction uses, so none can deadlock. */
export async function lockItems(tx: Prisma.TransactionClient, ids: readonly number[]): Promise<void> {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM items WHERE id = ANY(${sorted}::int[]) ORDER BY id FOR UPDATE`;
}

/** Locks one purchase batch; always taken after its item (§6.16). */
export async function lockBatch(tx: Prisma.TransactionClient, batchId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM purchase_batches WHERE id = ${batchId} FOR UPDATE`;
}

/** Locks one customer: the first lock of every operation that involves one (§4.8). */
export async function lockCustomer(tx: Prisma.TransactionClient, customerId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
}

/** Locks one driver, for its edit and archive. */
export async function lockDriver(tx: Prisma.TransactionClient, driverId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId} FOR UPDATE`;
}

/** Locks one order; always after its customer (§6.6). */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

/** Locks the order counter — last in the chain — and returns the last number handed out. */
export async function lockOrderCounter(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<{ last_number: number }[]>`
    SELECT last_number FROM order_counter WHERE id = 1 FOR UPDATE`;
  if (!row) throw new Error('order_counter has no row; constraints.sql inserts it');
  return row.last_number;
}
