import type { StockMovementReason } from '@pallet/shared';
import { Prisma } from '../../generated/prisma/client';
import type { ItemDerived, StockMovementRow } from './items.mapper';

type Client = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * The line's order is not cancelled, as an anti-join: it reads the few cancelled orders from their partial
 * index instead of joining every order ever recorded (Q62).
 */
const NOT_CANCELLED = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.id = ol.order_id AND o.cancelled_at IS NOT NULL
)`;

/**
 * Per item, the pallets out over orders that are not cancelled, and the pallets returned damaged over
 * live returns of such orders (§6.15, §12.5), read from the maintained line columns `recomputeOrder`
 * writes: `out_quantity`, and `returned_damaged` (the damaged quantities of the line's non-reversed
 * returns). Only lines with something out, or something damaged, are read (Q62). `scope` narrows the
 * lines to some items; the stock report reads every item.
 */
export function itemDerivedTotals(scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    SELECT i.id AS item_id,
           COALESCE(outstanding.quantity_out, 0)::bigint AS quantity_out,
           COALESCE(damaged.damaged_total, 0)::bigint AS damaged_total
    FROM items i
    LEFT JOIN (
      SELECT ol.item_id, SUM(ol.out_quantity) AS quantity_out
      FROM order_lines ol
      WHERE ol.out_quantity > 0 ${scope} AND ${NOT_CANCELLED}
      GROUP BY ol.item_id
    ) outstanding ON outstanding.item_id = i.id
    LEFT JOIN (
      SELECT ol.item_id, SUM(ol.returned_damaged) AS damaged_total
      FROM order_lines ol
      WHERE ol.returned_damaged > 0 ${scope} AND ${NOT_CANCELLED}
      GROUP BY ol.item_id
    ) damaged ON damaged.item_id = i.id`;
}

/** §6.15: the derived columns of the items a page shows, in one query. */
export async function queryItemDerived(client: Client, itemIds: readonly number[]): Promise<Map<number, ItemDerived>> {
  if (itemIds.length === 0) return new Map();
  const ids = [...itemIds];

  const rows = await client.$queryRaw<{ item_id: number; quantity_out: bigint; damaged_total: bigint }[]>`
    SELECT d.item_id, d.quantity_out, d.damaged_total
    FROM (${itemDerivedTotals(Prisma.sql`AND ol.item_id = ANY(${ids}::int[])`)}) d
    WHERE d.item_id = ANY(${ids}::int[])`;

  return new Map(
    rows.map((row) => [
      row.item_id,
      { quantityOut: Number(row.quantity_out), damagedTotal: Number(row.damaged_total) },
    ]),
  );
}

/**
 * One page of an item's ledger, newest first. The running balance is taken over the whole ledger
 * before the reason filter and the page cut, so a filtered row still shows the stock it left.
 */
export async function queryStockMovements(
  client: Client,
  itemId: number,
  reason: StockMovementReason | undefined,
  page: number,
  pageSize: number,
): Promise<{ rows: StockMovementRow[]; total: number }> {
  const reasonFilter = reason ? Prisma.sql`AND l.reason = ${reason}::stock_movement_reason` : Prisma.empty;

  const rows = await client.$queryRaw<StockMovementRow[]>`
    WITH ledger AS (
      SELECT sm.*, SUM(sm.quantity) OVER (ORDER BY sm.id)::int AS balance_after
      FROM stock_movements sm
      WHERE sm.item_id = ${itemId}
    )
    SELECT l.id, l.item_id AS "itemId", l.quantity, l.reason,
           l.batch_id AS "batchId", l.order_id AS "orderId", o.order_number AS "orderNumber",
           l.return_id AS "returnId", l.note, l.created_at AS "createdAt", l.balance_after AS "balanceAfter",
           u.id AS "userId", u.username, u.display_name AS "displayName"
    FROM ledger l
    JOIN users u ON u.id = l.created_by_user_id
    LEFT JOIN orders o ON o.id = l.order_id
    WHERE TRUE ${reasonFilter}
    ORDER BY l.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const counted = await client.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM stock_movements l WHERE l.item_id = ${itemId} ${reasonFilter}`;

  return { rows, total: counted[0]?.total ?? 0 };
}
