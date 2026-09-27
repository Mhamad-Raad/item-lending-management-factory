import type { StockReportDto, StockReportQuery } from '@pallet/shared';
import type { Clock } from '../../common/clock';
import { fromAggregate, type SqlAggregate } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import { Prisma } from '../../generated/prisma/client';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { itemDerivedTotals } from '../items/items.queries';
import { isLowStock, LOW_STOCK_SQL } from '../items/low-stock';
import { ROW_CAP } from './report-rows';

/** The stock report (§12.5): every item's stock, pallets out and damaged total, sorted in memory. */
export async function queryStockReport(
  db: Prisma.TransactionClient,
  query: StockReportQuery,
  clock: Clock,
): Promise<StockReportDto> {
  const archived = query.includeArchived ? Prisma.empty : Prisma.sql`AND i.archived_at IS NULL`;
  const lowOnly = query.lowStockOnly ? Prisma.sql`AND ${LOW_STOCK_SQL}` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: number; quantity_out: SqlAggregate; damaged_total: SqlAggregate }[]>`
    SELECT i.id, d.quantity_out, d.damaged_total
      FROM items i
      JOIN (${itemDerivedTotals()}) d ON d.item_id = i.id
     WHERE TRUE ${archived} ${lowOnly}`;
  const items = new Map(
    (await db.item.findMany({ where: { id: { in: rows.map((row) => row.id) } }, ...ITEM_REF_INCLUDE })).map((item) => [
      item.id,
      item,
    ]),
  );
  const result = rows.flatMap((row) => {
    const item = items.get(row.id);
    if (!item) return [];
    return [
      {
        item: toItemRef(item),
        quantityOnHand: item.quantityOnHand,
        quantityOut: fromAggregate(row.quantity_out),
        damagedTotal: fromAggregate(row.damaged_total),
        minStock: item.minStock,
        // An archived item is no longer restocked, so it is never low (§12.5).
        isLowStock: isLowStock(item, { archivedNeverLow: true }),
      },
    ];
  });
  const { field, direction } = parseSort<'name' | 'quantityOnHand' | 'quantityOut' | 'damagedTotal'>(query.sort);
  const sign = direction === 'asc' ? 1 : -1;
  result.sort((x, y) => {
    const primary = field === 'name' ? x.item.name.localeCompare(y.item.name) : x[field] - y[field];
    return primary * sign || x.item.name.localeCompare(y.item.name) || x.item.id - y.item.id;
  });
  const sum = (pick: (row: (typeof result)[number]) => number): number =>
    result.reduce((total, row) => total + pick(row), 0);
  return {
    generatedAt: clock.now().toISOString(),
    // §12.1: the first 5,000 rows; the totals count every item.
    rows: result.slice(0, ROW_CAP),
    totals: {
      quantityOnHand: sum((row) => row.quantityOnHand),
      quantityOut: sum((row) => row.quantityOut),
      damagedTotal: sum((row) => row.damagedTotal),
      lowStockCount: result.filter((row) => row.isLowStock).length,
    },
    truncated: result.length > ROW_CAP,
  };
}
