import {
  CUSTOMER_HISTORY_KINDS,
  businessDateToDb,
  dbDateToBusiness,
  type CustomerHistoryItemDto,
  type CustomerHistoryKind,
  type CustomerHistoryQuery,
  type PageDto,
} from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import { Prisma } from '../../generated/prisma/client';
import { toDriverRef } from '../drivers/drivers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';

type Client = Prisma.TransactionClient;

/**
 * A customer's timeline (§6.17): one `UNION ALL` of the entries' keys — hand-overs on the order date,
 * returns on theirs, ledger rows on their effective date — filtered, ordered and paged in SQL, then the
 * page hydrated in three batched reads. Reversed returns stay, flagged.
 */
export async function queryCustomerHistory(
  client: Client,
  customerId: number,
  query: CustomerHistoryQuery,
): Promise<PageDto<CustomerHistoryItemDto>> {
  const liveOrders = query.includeCancelled ? Prisma.empty : Prisma.sql`AND o.cancelled_at IS NULL`;
  const kinds: readonly CustomerHistoryKind[] = query.kinds ?? CUSTOMER_HISTORY_KINDS;
  const conditions = [Prisma.sql`t.kind = ANY(${kinds}::text[])`];
  if (query.dateFrom) conditions.push(Prisma.sql`t.date >= ${businessDateToDb(query.dateFrom)}`);
  if (query.dateTo) conditions.push(Prisma.sql`t.date <= ${businessDateToDb(query.dateTo)}`);

  const entries = Prisma.sql`
    FROM (
      SELECT 'HANDOVER' AS kind, o.id, o.date, o.created_at
        FROM orders o WHERE o.customer_id = ${customerId} ${liveOrders}
      UNION ALL
      SELECT 'RETURN', r.id, r.date, r.created_at
        FROM returns r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ${customerId} ${liveOrders}
      UNION ALL
      SELECT 'LEDGER', le.id, COALESCE(le.date, o.date), le.created_at
        FROM ledger_entries le JOIN orders o ON o.id = le.order_id WHERE o.customer_id = ${customerId} ${liveOrders}
    ) t
    WHERE ${Prisma.join(conditions, ' AND ')}`;

  const [keys, counted] = await Promise.all([
    client.$queryRaw<{ kind: CustomerHistoryKind; id: number }[]>`
      SELECT t.kind, t.id ${entries}
      ORDER BY t.date DESC, t.created_at DESC, t.kind ASC, t.id DESC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    client.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${entries}`,
  ]);

  const idsOf = (kind: CustomerHistoryKind): number[] => keys.filter((key) => key.kind === kind).map((key) => key.id);
  const [orders, returns, ledger] = await Promise.all([
    client.order.findMany({
      where: { id: { in: idsOf('HANDOVER') } },
      include: { driver: true, lines: { orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } } },
    }),
    client.palletReturn.findMany({
      where: { id: { in: idsOf('RETURN') } },
      include: {
        order: { select: { orderNumber: true } },
        lines: { orderBy: { id: 'asc' }, include: { orderLine: { include: { item: ITEM_REF_INCLUDE } } } },
      },
    }),
    client.ledgerEntry.findMany({
      where: { id: { in: idsOf('LEDGER') } },
      include: { order: { select: { orderNumber: true, date: true } } },
    }),
  ]);
  const byKey = new Map<string, CustomerHistoryItemDto>();

  for (const order of orders) {
    byKey.set(`HANDOVER:${order.id}`, {
      kind: 'HANDOVER',
      date: dbDateToBusiness(order.date),
      createdAt: order.createdAt.toISOString(),
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentType: order.paymentType,
      status: order.status,
      cancelled: order.cancelledAt !== null,
      driver: toDriverRef(order.driver),
      lines: order.lines.map((line) => ({
        item: toItemRef(line.item),
        quantity: line.quantity,
        unitDeposit: toSafeMoney(line.unitDeposit),
        lineTotal: toSafeMoney(line.lineTotal),
      })),
      quantityTotal: order.lines.reduce((total, line) => total + line.quantity, 0),
      depositTotal: toSafeMoney(order.depositTotal),
    });
  }
  for (const pr of returns) {
    byKey.set(`RETURN:${pr.id}`, {
      kind: 'RETURN',
      date: dbDateToBusiness(pr.date),
      createdAt: pr.createdAt.toISOString(),
      returnId: pr.id,
      orderId: pr.orderId,
      orderNumber: pr.order.orderNumber,
      reversed: pr.reversedAt !== null,
      reversalKind: pr.reversalKind,
      replacedByReturnId: pr.replacedByReturnId,
      lines: pr.lines.map((line) => ({
        item: toItemRef(line.orderLine.item),
        acceptedQuantity: line.acceptedQuantity,
        damagedQuantity: line.damagedQuantity,
        damagedRefund: toSafeMoney(line.damagedRefund),
      })),
      acceptedTotal: pr.lines.reduce((total, line) => total + line.acceptedQuantity, 0),
      damagedTotal: pr.lines.reduce((total, line) => total + line.damagedQuantity, 0),
      refundDue: toSafeMoney(pr.refundDue),
      cashRefund: toSafeMoney(pr.cashRefund),
    });
  }
  for (const entry of ledger) {
    byKey.set(`LEDGER:${entry.id}`, {
      kind: 'LEDGER',
      date: dbDateToBusiness(entry.date ?? entry.order.date),
      createdAt: entry.createdAt.toISOString(),
      ledgerEntryId: entry.id,
      orderId: entry.orderId,
      orderNumber: entry.order.orderNumber,
      type: entry.type,
      source: entry.source,
      amount: toSafeMoney(entry.amount),
      isAutomatic: entry.isAutomatic,
      reversesEntryId: entry.reversesEntryId,
      note: entry.note,
    });
  }

  return {
    items: keys.flatMap((key) => {
      const item = byKey.get(`${key.kind}:${key.id}`);
      return item ? [item] : [];
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: counted[0]?.total ?? 0,
  };
}
