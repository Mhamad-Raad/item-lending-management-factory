import type { StockMovementReason } from '@pallet/shared';
import { Prisma } from '../../generated/prisma/client';
import type { ItemDerived, StockMovementRow } from './items.mapper';

type Client = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * §6.15: per item, the pallets out over orders that are not cancelled, and the pallets returned
 * damaged over live returns of such orders — one query for however many items a page shows.
 */
export async function queryItemDerived(client: Client, itemIds: readonly number[]): Promise<Map<number, ItemDerived>> {
  if (itemIds.length === 0) return new Map();

  const rows = await client.$queryRaw<(ItemDerived & { itemId: number })[]>`
    SELECT i.id AS "itemId",
           COALESCE(outstanding.quantity_out, 0)::int AS "quantityOut",
           COALESCE(damaged.damaged_total, 0)::int AS "damagedTotal"
    FROM items i
    LEFT JOIN (
      SELECT ol.item_id, SUM(ol.out_quantity) AS quantity_out
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id AND o.cancelled_at IS NULL
      GROUP BY ol.item_id
    ) outstanding ON outstanding.item_id = i.id
    LEFT JOIN (
      SELECT ol.item_id, SUM(rl.damaged_quantity) AS damaged_total
      FROM return_lines rl
      JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
      JOIN order_lines ol ON ol.id = rl.order_line_id
      JOIN orders o ON o.id = ol.order_id AND o.cancelled_at IS NULL
      GROUP BY ol.item_id
    ) damaged ON damaged.item_id = i.id
    WHERE i.id = ANY(${[...itemIds]}::int[])`;

  return new Map(rows.map(({ itemId, ...derived }) => [itemId, derived]));
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
