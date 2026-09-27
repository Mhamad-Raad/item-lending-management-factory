import { businessDateToDb, dbDateToBusiness, type ActivityReportDto, type ActivityReportQuery } from '@pallet/shared';
import type { Clock } from '../../common/clock';
import { fromAggregate, toSafeMoney, type SqlAggregate } from '../../common/utils/money';
import { Prisma } from '../../generated/prisma/client';
import { toCustomerRef } from '../customers/customers.mapper';
import { toDriverRef } from '../drivers/drivers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from '../ledger/ledger.mapper';
import { ROW_CAP } from './report-rows';

/**
 * The activity report (§12.4): a period's hand-overs, returns, payments, refunds and compensation,
 * each section's keys and totals in SQL over live orders, then the first `ROW_CAP` rows of each
 * hydrated. With an item filter the money sections are omitted. The caller has checked the period.
 */
export async function queryActivityReport(
  db: Prisma.TransactionClient,
  query: ActivityReportQuery,
  clock: Clock,
): Promise<ActivityReportDto> {
  const from = businessDateToDb(query.dateFrom);
  const to = businessDateToDb(query.dateTo);
  const moneyOmitted = query.itemId !== undefined;
  // F(o) of §12.4: live orders, through the order's customer and driver.
  const orderFilter = Prisma.sql`
    o.cancelled_at IS NULL
    ${query.customerId ? Prisma.sql`AND o.customer_id = ${query.customerId}` : Prisma.empty}
    ${query.driverId ? Prisma.sql`AND o.driver_id = ${query.driverId}` : Prisma.empty}`;
  const lineFilter = query.itemId ? Prisma.sql`AND ol.item_id = ${query.itemId}` : Prisma.empty;
  const itemIdFilter = query.itemId === undefined ? {} : { itemId: query.itemId };

  const [handoverKeys, handoverTotals, returnKeys, returnTotals, compensationRows] = await Promise.all([
    db.$queryRaw<{ id: number }[]>`
      SELECT o.id FROM orders o
       WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date
         AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id ${lineFilter})
       ORDER BY o.date ASC, o.created_at ASC, o.id ASC LIMIT ${ROW_CAP + 1}`,
    db.$queryRaw<{ quantity: SqlAggregate; deposit: SqlAggregate }[]>`
      SELECT SUM(ol.quantity)::bigint AS quantity, SUM(ol.line_total)::bigint AS deposit
        FROM order_lines ol JOIN orders o ON o.id = ol.order_id
       WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date ${lineFilter}`,
    db.$queryRaw<{ id: number }[]>`
      SELECT r.id FROM returns r JOIN orders o ON o.id = r.order_id
       WHERE ${orderFilter} AND r.reversed_at IS NULL AND r.date BETWEEN ${from}::date AND ${to}::date
         AND EXISTS (SELECT 1 FROM return_lines rl JOIN order_lines ol ON ol.id = rl.order_line_id
                      WHERE rl.return_id = r.id ${lineFilter})
       ORDER BY r.date ASC, r.created_at ASC, r.id ASC LIMIT ${ROW_CAP + 1}`,
    db.$queryRaw<
      { accepted: SqlAggregate; damaged: SqlAggregate; refund_due: SqlAggregate; compensation: SqlAggregate }[]
    >`
      SELECT SUM(rl.accepted_quantity)::bigint AS accepted, SUM(rl.damaged_quantity)::bigint AS damaged,
             SUM(rl.accepted_quantity * rl.unit_deposit + rl.damaged_refund)::bigint AS refund_due,
             SUM(rl.damaged_quantity * rl.unit_deposit - rl.damaged_refund)::bigint AS compensation
        FROM return_lines rl
        JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
        JOIN order_lines ol ON ol.id = rl.order_line_id
        JOIN orders o ON o.id = r.order_id
       WHERE ${orderFilter} AND r.date BETWEEN ${from}::date AND ${to}::date ${lineFilter}`,
    db.$queryRaw<{ id: number }[]>`
      SELECT rl.id FROM return_lines rl
        JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
        JOIN order_lines ol ON ol.id = rl.order_line_id
        JOIN orders o ON o.id = r.order_id
       WHERE ${orderFilter} AND r.date BETWEEN ${from}::date AND ${to}::date AND rl.damaged_quantity > 0 ${lineFilter}
       ORDER BY r.date ASC, r.created_at ASC, rl.id ASC LIMIT ${ROW_CAP + 1}`,
  ]);

  const money = moneyOmitted
    ? null
    : await Promise.all(
        (['PAYMENT', 'REFUND'] as const).map((kind) => queryMoneySection(db, kind, orderFilter, from, to)),
      );

  const [handovers, returns, compensation, ledger] = await Promise.all([
    db.order.findMany({
      where: { id: { in: cap(handoverKeys) } },
      include: {
        customer: true,
        driver: true,
        lines: { where: itemIdFilter, orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } },
      },
    }),
    db.palletReturn.findMany({
      where: { id: { in: cap(returnKeys) } },
      include: {
        order: { include: { customer: true } },
        lines: {
          where: query.itemId ? { orderLine: itemIdFilter } : {},
          orderBy: { id: 'asc' },
          include: { orderLine: { include: { item: ITEM_REF_INCLUDE } } },
        },
      },
    }),
    db.returnLine.findMany({
      where: { id: { in: cap(compensationRows) } },
      include: {
        return: { include: { order: { include: { customer: true } } } },
        orderLine: { include: { item: ITEM_REF_INCLUDE } },
      },
    }),
    money
      ? db.ledgerEntry.findMany({
          where: { id: { in: [...cap(money[0]?.keys ?? []), ...cap(money[1]?.keys ?? [])] } },
          include: { ...LEDGER_ENTRY_INCLUDE, order: { include: { customer: true } } },
        })
      : Promise.resolve([]),
  ]);
  const ledgerDto = (keys: { id: number }[]) =>
    inOrder(keys, ledger).map((entry) => toLedgerEntryDto(entry, entry.order));
  const payments = money?.[0];
  const refunds = money?.[1];
  const handoverTotal = handoverTotals[0];
  const returnTotal = returnTotals[0];

  return {
    generatedAt: clock.now().toISOString(),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    filters: {
      customerId: query.customerId ?? null,
      itemId: query.itemId ?? null,
      driverId: query.driverId ?? null,
    },
    moneyOmitted,
    handovers: inOrder(handoverKeys, handovers).map((order) => {
      const lines = order.lines.map((line) => ({
        item: toItemRef(line.item),
        quantity: line.quantity,
        unitDeposit: toSafeMoney(line.unitDeposit),
        lineTotal: toSafeMoney(line.lineTotal),
      }));
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        date: dbDateToBusiness(order.date),
        customer: toCustomerRef(order.customer),
        driver: toDriverRef(order.driver),
        paymentType: order.paymentType,
        lines,
        quantity: lines.reduce((total, line) => total + line.quantity, 0),
        depositTotal: lines.reduce((total, line) => total + line.lineTotal, 0),
      };
    }),
    returns: inOrder(returnKeys, returns).map((pr) => {
      const lines = pr.lines.map((line) => {
        const unitDeposit = toSafeMoney(line.unitDeposit);
        const damagedRefund = toSafeMoney(line.damagedRefund);
        return {
          item: toItemRef(line.orderLine.item),
          acceptedQuantity: line.acceptedQuantity,
          damagedQuantity: line.damagedQuantity,
          damagedRefund,
          compensation: line.damagedQuantity * unitDeposit - damagedRefund,
          credit: line.acceptedQuantity * unitDeposit + damagedRefund,
        };
      });
      return {
        returnId: pr.id,
        orderId: pr.orderId,
        orderNumber: pr.order.orderNumber,
        date: dbDateToBusiness(pr.date),
        customer: toCustomerRef(pr.order.customer),
        lines: lines.map(({ credit: _credit, ...line }) => line),
        acceptedQuantity: lines.reduce((total, line) => total + line.acceptedQuantity, 0),
        damagedQuantity: lines.reduce((total, line) => total + line.damagedQuantity, 0),
        // Over the lines shown: with an item filter, the credit that item's lines gave.
        refundDue: lines.reduce((total, line) => total + line.credit, 0),
        // Cash is paid per return, not per item: with an item filter it is not the item's to show.
        cashRefund: query.itemId === undefined ? toSafeMoney(pr.cashRefund) : 0,
      };
    }),
    payments: payments ? ledgerDto(payments.keys) : [],
    refunds: refunds ? ledgerDto(refunds.keys) : [],
    compensation: inOrder(compensationRows, compensation).map((line) => {
      const unitDeposit = toSafeMoney(line.unitDeposit);
      const damagedRefund = toSafeMoney(line.damagedRefund);
      return {
        returnId: line.returnId,
        orderNumber: line.return.order.orderNumber,
        date: dbDateToBusiness(line.return.date),
        customer: toCustomerRef(line.return.order.customer),
        item: toItemRef(line.orderLine.item),
        damagedQuantity: line.damagedQuantity,
        unitDeposit,
        damagedRefund,
        compensation: line.damagedQuantity * unitDeposit - damagedRefund,
      };
    }),
    totals: {
      handoverQuantity: fromAggregate(handoverTotal?.quantity ?? 0),
      handoverDepositTotal: fromAggregate(handoverTotal?.deposit ?? 0),
      returnedAccepted: fromAggregate(returnTotal?.accepted ?? 0),
      returnedDamaged: fromAggregate(returnTotal?.damaged ?? 0),
      refundDueTotal: fromAggregate(returnTotal?.refund_due ?? 0),
      paymentsGross: payments?.gross ?? 0,
      paymentReversals: payments?.reversals ?? 0,
      paymentsNet: (payments?.gross ?? 0) - (payments?.reversals ?? 0),
      refundsGross: refunds?.gross ?? 0,
      refundReversals: refunds?.reversals ?? 0,
      refundsNet: (refunds?.gross ?? 0) - (refunds?.reversals ?? 0),
      compensationAssessed: fromAggregate(returnTotal?.compensation ?? 0),
    },
    truncated: [handoverKeys, returnKeys, compensationRows, ...(money ?? []).map((section) => section.keys)].some(
      (keys) => keys.length > ROW_CAP,
    ),
  };
}

/** The first `ROW_CAP` keys of a section, as ids. */
function cap(keys: { id: number }[]): number[] {
  return keys.slice(0, ROW_CAP).map((row) => row.id);
}

/** The hydrated rows of a section in the order of its first `ROW_CAP` keys. */
function inOrder<T extends { id: number }>(keys: { id: number }[], found: T[]): T[] {
  const byId = new Map(found.map((row) => [row.id, row]));
  return cap(keys).flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/**
 * One money section (§12.4): the keys of a period's payments or refunds with their reversals, by
 * effective date, and the gross and reversed sums over the whole period.
 */
async function queryMoneySection(
  db: Prisma.TransactionClient,
  kind: 'PAYMENT' | 'REFUND',
  orderFilter: Prisma.Sql,
  from: Date,
  to: Date,
): Promise<{ keys: { id: number }[]; gross: number; reversals: number }> {
  const types = kind === 'PAYMENT' ? ['PAYMENT', 'PAYMENT_REVERSAL'] : ['REFUND', 'REFUND_REVERSAL'];
  const moneyWhere = Prisma.sql`
    ${orderFilter} AND le.type::text = ANY(${types}::text[])
    AND COALESCE(le.date, o.date) BETWEEN ${from}::date AND ${to}::date`;
  const [keys, totals] = await Promise.all([
    db.$queryRaw<{ id: number }[]>`
      SELECT le.id FROM ledger_entries le JOIN orders o ON o.id = le.order_id
       WHERE ${moneyWhere}
       ORDER BY COALESCE(le.date, o.date) ASC, le.created_at ASC, le.id ASC LIMIT ${ROW_CAP + 1}`,
    db.$queryRaw<{ gross: SqlAggregate; reversals: SqlAggregate }[]>`
      SELECT COALESCE(SUM(le.amount) FILTER (WHERE le.type::text = ${kind}), 0)::bigint AS gross,
             COALESCE(SUM(le.amount) FILTER (WHERE le.type::text <> ${kind}), 0)::bigint AS reversals
        FROM ledger_entries le JOIN orders o ON o.id = le.order_id
       WHERE ${moneyWhere}`,
  ]);
  return {
    keys,
    gross: fromAggregate(totals[0]?.gross ?? 0),
    reversals: fromAggregate(totals[0]?.reversals ?? 0),
  };
}
