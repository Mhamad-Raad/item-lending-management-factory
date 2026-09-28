import type { PositionsReportDto, PositionsReportQuery } from '@pallet/shared';
import type { Clock } from '../../common/clock';
import { fromAggregate, type SqlAggregate } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import { Prisma } from '../../generated/prisma/client';
import { toCustomerRef } from '../customers/customers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { openOrderTotalsByCustomer } from '../orders/open-order-totals';
import { byItemName, ROW_CAP } from './report-rows';

/**
 * The positions report (§12.2): per customer, the pallets out by item and the standing money, sorted
 * in memory (one small row per customer) and cut at `ROW_CAP`; the totals count every customer.
 */
export async function queryPositionsReport(
  db: Prisma.TransactionClient,
  query: PositionsReportQuery,
  clock: Clock,
): Promise<PositionsReportDto> {
  const customerFilter = query.customerId ? Prisma.sql`AND c.id = ${query.customerId}` : Prisma.empty;
  const zeroFilter = query.includeZero
    ? Prisma.empty
    : Prisma.sql`AND (COALESCE(pc.pallets_out, 0) > 0 OR COALESCE(pc.owed, 0) > 0 OR COALESCE(pc.held, 0) > 0)`;
  const rows = await db.$queryRaw<
    { id: number; pallets_out: SqlAggregate; out_value: SqlAggregate; owed: SqlAggregate; held: SqlAggregate }[]
  >`
    WITH per_customer AS (${openOrderTotalsByCustomer()})
    SELECT c.id, pc.pallets_out, pc.out_value, pc.owed, pc.held
      FROM customers c
      LEFT JOIN per_customer pc ON pc.customer_id = c.id
     WHERE TRUE ${customerFilter} ${zeroFilter}
     ORDER BY c.id`;
  const ids = rows.map((row) => row.id);
  const names = new Map(
    (await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((customer) => [
      customer.id,
      customer.name,
    ]),
  );
  const ranked = rows.flatMap((row) => {
    const name = names.get(row.id);
    if (name === undefined) return [];
    return [
      {
        id: row.id,
        name,
        palletsOut: fromAggregate(row.pallets_out),
        outValue: fromAggregate(row.out_value),
        owed: fromAggregate(row.owed),
        held: fromAggregate(row.held),
      },
    ];
  });
  const { field, direction } = parseSort<'customerName' | 'palletsOut' | 'outValue' | 'owed' | 'held'>(query.sort);
  const sign = direction === 'asc' ? 1 : -1;
  // One small row per customer: ordered in memory, the name breaking every tie.
  ranked.sort((x, y) => {
    const primary = field === 'customerName' ? x.name.localeCompare(y.name) : x[field] - y[field];
    return primary * sign || x.name.localeCompare(y.name) || x.id - y.id;
  });
  // §12.1: the first 5,000 rows are drawn; the totals below still count every customer.
  const kept = ranked.slice(0, ROW_CAP);
  const keptIds = kept.map((row) => row.id);

  // Per item over every included customer: a customer the zero filter leaves out has nothing out, so
  // the customer filter alone selects the same pallets.
  const orderCustomerFilter = query.customerId ? Prisma.sql`AND o.customer_id = ${query.customerId}` : Prisma.empty;
  // One after the other: a transaction is one connection, which runs one query at a time.
  const itemTotals = await db.$queryRaw<{ item_id: number; quantity: SqlAggregate }[]>`
      SELECT ol.item_id, SUM(ol.out_quantity)::bigint AS quantity
        FROM order_lines ol JOIN orders o ON o.id = ol.order_id
       WHERE o.cancelled_at IS NULL AND ol.out_quantity > 0 ${orderCustomerFilter}
       GROUP BY ol.item_id`;
  const perItem = keptIds.length
    ? await db.$queryRaw<{ customer_id: number; item_id: number; quantity: SqlAggregate }[]>`
          SELECT o.customer_id, ol.item_id, SUM(ol.out_quantity)::bigint AS quantity
            FROM order_lines ol JOIN orders o ON o.id = ol.order_id
           WHERE o.cancelled_at IS NULL AND ol.out_quantity > 0 AND o.customer_id = ANY(${keptIds}::int[])
           GROUP BY o.customer_id, ol.item_id`
    : [];
  const customers = await db.customer.findMany({ where: { id: { in: keptIds } } });
  const items = await db.item.findMany({
    where: { id: { in: itemTotals.map((row) => row.item_id) } },
    ...ITEM_REF_INCLUDE,
  });
  const columns = items.map(toItemRef).sort(byItemName);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const itemTotal = new Map(itemTotals.map((row) => [row.item_id, fromAggregate(row.quantity)]));
  // Keyed once: a lookup per customer × item column stays constant-time on a large customer list.
  const perItemQuantity = new Map(
    perItem.map((row) => [`${row.customer_id}:${row.item_id}`, fromAggregate(row.quantity)]),
  );
  const quantityOf = (customerId: number, itemId: number): number =>
    perItemQuantity.get(`${customerId}:${itemId}`) ?? 0;

  const result = kept.flatMap(({ id, name: _name, ...sums }) => {
    const customer = customerById.get(id);
    if (!customer) return [];
    return [
      {
        customer: toCustomerRef(customer),
        // Only the items this customer has out (Q103): a zero for every other column was most of the answer.
        palletsOutByItem: columns.flatMap((item) => {
          const quantityOut = quantityOf(id, item.id);
          return quantityOut > 0 ? [{ itemId: item.id, quantityOut }] : [];
        }),
        ...sums,
      },
    ];
  });

  const sum = (pick: (row: (typeof ranked)[number]) => number): number =>
    ranked.reduce((total, row) => total + pick(row), 0);
  return {
    generatedAt: clock.now().toISOString(),
    columns,
    rows: result,
    totals: {
      palletsOutByItem: columns.map((item) => ({ itemId: item.id, quantityOut: itemTotal.get(item.id) ?? 0 })),
      palletsOut: sum((row) => row.palletsOut),
      outValue: sum((row) => row.outValue),
      owed: sum((row) => row.owed),
      held: sum((row) => row.held),
    },
    truncated: ranked.length > ROW_CAP,
  };
}
