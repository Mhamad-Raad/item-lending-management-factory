import { businessDateToDb, dbDateToBusiness, type PurchasesReportDto, type PurchasesReportQuery } from '@pallet/shared';
import type { Clock } from '../../common/clock';
import { fromAggregate, toSafeMoney, type SqlAggregate } from '../../common/utils/money';
import { Prisma } from '../../generated/prisma/client';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { byItemName, ROW_CAP } from './report-rows';

/**
 * The purchases report (§12.3): the live batches of a period in date order, cut at `ROW_CAP`, and per
 * item their count, quantity and cost over the whole period. The caller has checked cost access and
 * the period.
 */
export async function queryPurchasesReport(
  db: Prisma.TransactionClient,
  query: PurchasesReportQuery,
  clock: Clock,
): Promise<PurchasesReportDto> {
  const where = Prisma.sql`
    pb.deleted_at IS NULL
    AND pb.date BETWEEN ${businessDateToDb(query.dateFrom)}::date AND ${businessDateToDb(query.dateTo)}::date
    ${query.itemId ? Prisma.sql`AND pb.item_id = ${query.itemId}` : Prisma.empty}`;

  const [batches, perItem] = await Promise.all([
    db.$queryRaw<{ id: number }[]>`
      SELECT pb.id FROM purchase_batches pb WHERE ${where} ORDER BY pb.date ASC, pb.id ASC LIMIT ${ROW_CAP + 1}`,
    db.$queryRaw<{ item_id: number; batch_count: SqlAggregate; quantity: SqlAggregate; total_cost: SqlAggregate }[]>`
      SELECT pb.item_id, COUNT(*)::bigint AS batch_count, SUM(pb.quantity)::bigint AS quantity,
             SUM(pb.total_cost)::bigint AS total_cost
        FROM purchase_batches pb WHERE ${where} GROUP BY pb.item_id`,
  ]);
  const page = batches.slice(0, ROW_CAP).map((row) => row.id);
  const stored = await db.purchaseBatch.findMany({
    where: { id: { in: page } },
    include: { item: ITEM_REF_INCLUDE },
  });
  const byId = new Map(stored.map((batch) => [batch.id, batch]));
  const items = new Map(
    (await db.item.findMany({ where: { id: { in: perItem.map((row) => row.item_id) } }, ...ITEM_REF_INCLUDE })).map(
      (item) => [item.id, toItemRef(item)],
    ),
  );

  const perItemRows = perItem
    .flatMap((row) => {
      const item = items.get(row.item_id);
      return item
        ? [
            {
              item,
              batchCount: fromAggregate(row.batch_count),
              quantity: fromAggregate(row.quantity),
              totalCost: fromAggregate(row.total_cost),
            },
          ]
        : [];
    })
    .sort((x, y) => byItemName(x.item, y.item));
  return {
    generatedAt: clock.now().toISOString(),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    rows: page.flatMap((id) => {
      const batch = byId.get(id);
      return batch
        ? [
            {
              batchId: batch.id,
              item: toItemRef(batch.item),
              date: dbDateToBusiness(batch.date),
              quantity: batch.quantity,
              unitCost: toSafeMoney(batch.unitCost),
              totalCost: toSafeMoney(batch.totalCost),
              note: batch.note,
            },
          ]
        : [];
    }),
    perItem: perItemRows,
    totals: {
      batchCount: perItemRows.reduce((total, row) => total + row.batchCount, 0),
      quantity: perItemRows.reduce((total, row) => total + row.quantity, 0),
      totalCost: perItemRows.reduce((total, row) => total + row.totalCost, 0),
    },
    truncated: batches.length > ROW_CAP,
  };
}
