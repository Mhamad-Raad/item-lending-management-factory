import type { Prisma } from '../../generated/prisma/client';

/**
 * What a customer has out of each item now, over their orders. Pallets are out only on an open order — a settled one
 * holds none, a cancelled one is zeroed (Q39) —, so the read goes through `orders (customer_id, status)` and never the
 * settled history (as the hand-over receipt reads its earlier pallets, Q150). The one reading of it: the return's
 * surplus check, a correction's and the pallet credit's rule (Q170), and the receipts' "With customer" (Q169).
 */
export async function openOutByItem(
  client: Prisma.TransactionClient,
  customerId: number,
  itemIds: readonly number[],
): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await client.orderLine.groupBy({
    by: ['itemId'],
    where: { itemId: { in: [...new Set(itemIds)] }, outQuantity: { gt: 0 }, order: { customerId, status: 'OPEN' } },
    _sum: { outQuantity: true },
  });
  return new Map(rows.map((row) => [row.itemId, row._sum.outQuantity ?? 0]));
}
