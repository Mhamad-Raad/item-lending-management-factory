import { dbDateToBusiness, type CustomerHoldingDto, type CustomerListQuery } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import { escapeLikePattern, phoneSearchPattern } from '../../common/utils/search';
import { parseSort } from '../../common/utils/sort';
import { Prisma } from '../../generated/prisma/client';
import { uploadUrl } from '../uploads/uploads.mapper';
import type { OrderTotals } from './customers.mapper';

type Client = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Per customer, the sums of its orders that are not cancelled — per-order `held` is summed (§4.5, §6.17).
 * Pallets out, out value, owed and held are read from OPEN orders only: a SETTLED order has all four at
 * zero (`orders_settled_nothing_standing_check`), so the sums are the same and the work is proportional
 * to what is still standing, not to years of history (Q62). Compensation stays assessed after settlement,
 * so it is summed over the orders that carry any. `scope` narrows both to some customers.
 */
function fromCustomers(scope: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(out_quantity_total)::int AS pallets_out,
             SUM(out_value)::bigint AS out_value,
             SUM(owed)::bigint AS owed,
             SUM(held)::bigint AS held,
             COUNT(*)::int AS open_order_count
      FROM orders
      WHERE status = 'OPEN' ${scope}
      GROUP BY customer_id
    ) t ON t.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(compensation)::bigint AS compensation
      FROM orders
      WHERE compensation > 0 AND status <> 'CANCELLED' ${scope}
      GROUP BY customer_id
    ) k ON k.customer_id = c.id`;
}

/** A customer without orders has no `t` or `k` row, and zeros. */
const TOTAL_COLUMNS = Prisma.sql`
  c.id,
  COALESCE(t.pallets_out, 0)::int AS "palletsOut",
  COALESCE(t.out_value, 0)::bigint AS "outValue",
  COALESCE(t.owed, 0)::bigint AS "owed",
  COALESCE(t.held, 0)::bigint AS "held",
  COALESCE(k.compensation, 0)::bigint AS "compensation",
  COALESCE(t.open_order_count, 0)::int AS "openOrderCount"`;

/** Output names or plain columns, never input: the sort field is picked from this map. */
const SORT_COLUMNS = {
  name: Prisma.sql`c.name`,
  palletsOut: Prisma.sql`"palletsOut"`,
  outValue: Prisma.sql`"outValue"`,
  owed: Prisma.sql`"owed"`,
  held: Prisma.sql`"held"`,
  createdAt: Prisma.sql`c.created_at`,
} as const;

interface TotalsRow {
  id: number;
  palletsOut: number;
  outValue: bigint;
  owed: bigint;
  held: bigint;
  compensation: bigint;
  openOrderCount: number;
}

function toTotals(row: TotalsRow): OrderTotals {
  return {
    palletsOut: row.palletsOut,
    outValue: toSafeMoney(row.outValue),
    owed: toSafeMoney(row.owed),
    held: toSafeMoney(row.held),
    compensation: toSafeMoney(row.compensation),
    openOrderCount: row.openOrderCount,
  };
}

export async function queryCustomerTotals(
  client: Client,
  customerIds: readonly number[],
): Promise<Map<number, OrderTotals>> {
  if (customerIds.length === 0) return new Map();
  const ids = [...customerIds];
  const rows = await client.$queryRaw<TotalsRow[]>`
    SELECT ${TOTAL_COLUMNS} ${fromCustomers(Prisma.sql`AND customer_id = ANY(${ids}::int[])`)}
    WHERE c.id = ANY(${ids}::int[])`;
  return new Map(rows.map((row) => [row.id, toTotals(row)]));
}

/** One page of customers with their totals, filtered and sorted in SQL: the sort may be a total. */
export async function queryCustomerPage(
  client: Client,
  query: CustomerListQuery,
): Promise<{ rows: (OrderTotals & { id: number })[]; total: number }> {
  const conditions: Prisma.Sql[] = [];
  if (!query.includeArchived) conditions.push(Prisma.sql`c.archived_at IS NULL`);
  if (query.q) {
    const name = `%${escapeLikePattern(query.q)}%`;
    const phone = phoneSearchPattern(query.q);
    conditions.push(
      phone === undefined
        ? Prisma.sql`c.name ILIKE ${name}`
        : Prisma.sql`(c.name ILIKE ${name} OR c.phone LIKE ${`%${phone}%`} OR c.alt_phone LIKE ${`%${phone}%`})`,
    );
  }
  if (query.hasOpenOrders !== undefined) {
    conditions.push(
      query.hasOpenOrders
        ? Prisma.sql`COALESCE(t.open_order_count, 0) > 0`
        : Prisma.sql`COALESCE(t.open_order_count, 0) = 0`,
    );
  }
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  const { field, direction } = parseSort<keyof typeof SORT_COLUMNS>(query.sort);
  const order = Prisma.sql`${SORT_COLUMNS[field]} ${direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`}, c.id ASC`;

  const [rows, counted] = await Promise.all([
    client.$queryRaw<TotalsRow[]>`
      SELECT ${TOTAL_COLUMNS} ${fromCustomers()} ${where}
      ORDER BY ${order}
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    client.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${fromCustomers()} ${where}`,
  ]);
  return { rows: rows.map((row) => ({ id: row.id, ...toTotals(row) })), total: counted[0]?.total ?? 0 };
}

interface HoldingRow {
  itemId: number;
  itemName: string;
  itemArchived: boolean;
  fileName: string | null;
  orderId: number;
  orderNumber: number;
  orderDate: Date;
  quantityOut: number;
  unitDeposit: bigint;
}

/** The pallets a customer holds, per item, with the orders they went out on (§4.5). */
export async function queryCustomerHoldings(client: Client, customerId: number): Promise<CustomerHoldingDto[]> {
  const rows = await client.$queryRaw<HoldingRow[]>`
    SELECT i.id AS "itemId", i.name AS "itemName", i.archived_at IS NOT NULL AS "itemArchived",
           u.file_name AS "fileName", o.id AS "orderId", o.order_number AS "orderNumber",
           o.date AS "orderDate", ol.out_quantity AS "quantityOut", ol.unit_deposit AS "unitDeposit"
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    JOIN items i ON i.id = ol.item_id
    LEFT JOIN uploads u ON u.id = i.image_upload_id
    WHERE o.customer_id = ${customerId} AND o.cancelled_at IS NULL AND ol.out_quantity > 0
    ORDER BY i.name, i.id, o.date, o.order_number`;

  // Rows arrive grouped by item in name order; a Map keeps that order.
  const holdings = new Map<number, CustomerHoldingDto>();
  for (const row of rows) {
    const unitDeposit = toSafeMoney(row.unitDeposit);
    let holding = holdings.get(row.itemId);
    if (!holding) {
      holding = {
        item: {
          id: row.itemId,
          name: row.itemName,
          imageUrl: row.fileName ? uploadUrl(row.fileName) : null,
          archived: row.itemArchived,
        },
        quantityOut: 0,
        outValue: 0,
        sources: [],
      };
      holdings.set(row.itemId, holding);
    }
    holding.quantityOut += row.quantityOut;
    holding.outValue += row.quantityOut * unitDeposit;
    holding.sources.push({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderDate: dbDateToBusiness(row.orderDate),
      quantityOut: row.quantityOut,
      unitDeposit,
    });
  }
  return [...holdings.values()];
}
