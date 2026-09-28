import type { StockMovementReason } from '@pallet/shared';
import { pageSqlLimit } from '../../common/utils/pagination';
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
 * One page of an item's ledger, newest first, each row with the stock it left (Q102). The page is cut
 * first, from `stock_movements (item_id, id)`; the balance after its newest row is the item's stock less
 * everything written since (`quantity_on_hand` is the sum of its movements, §4.9 R1); each row's balance
 * steps back from there over the movements between the page's first and last row — all of them, so a row
 * the reason filter shows still carries the stock the whole ledger left. The old running total over the
 * whole history grew with every movement ever written.
 */
export async function queryStockMovements(
  client: Client,
  itemId: number,
  reason: StockMovementReason | undefined,
  page: number,
  pageSize: number,
): Promise<{ rows: StockMovementRow[]; total: number }> {
  const reasonFilter = reason ? Prisma.sql`AND sm.reason = ${reason}::stock_movement_reason` : Prisma.empty;

  const rows = await client.$queryRaw<StockMovementRow[]>`
    WITH page AS (
      SELECT sm.id FROM stock_movements sm
       WHERE sm.item_id = ${itemId} ${reasonFilter}
       ORDER BY sm.id DESC
       ${pageSqlLimit({ page, pageSize })}
    ), bounds AS (
      SELECT MIN(id) AS lo, MAX(id) AS hi FROM page
    ), newest AS (
      SELECT i.quantity_on_hand - COALESCE((
               SELECT SUM(n.quantity) FROM stock_movements n
                WHERE n.item_id = ${itemId} AND n.id > (SELECT hi FROM bounds)
             ), 0) AS balance
        FROM items i WHERE i.id = ${itemId}
    ), span AS (
      SELECT n.id,
             (newest.balance - COALESCE(SUM(n.quantity) OVER (
               ORDER BY n.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0))::int AS balance_after
        FROM stock_movements n CROSS JOIN newest
       WHERE n.item_id = ${itemId} AND n.id BETWEEN (SELECT lo FROM bounds) AND (SELECT hi FROM bounds)
    )
    SELECT l.id, l.item_id AS "itemId", l.quantity, l.reason,
           l.batch_id AS "batchId", l.order_id AS "orderId", o.order_number AS "orderNumber",
           l.return_id AS "returnId", l.note, l.created_at AS "createdAt", span.balance_after AS "balanceAfter",
           u.id AS "userId", u.username, u.display_name AS "displayName"
    FROM page
    JOIN span ON span.id = page.id
    JOIN stock_movements l ON l.id = page.id
    JOIN users u ON u.id = l.created_by_user_id
    LEFT JOIN orders o ON o.id = l.order_id
    ORDER BY l.id DESC`;

  const counted = await client.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM stock_movements sm WHERE sm.item_id = ${itemId} ${reasonFilter}`;

  return { rows, total: counted[0]?.total ?? 0 };
}
