import {
  businessDateToDb,
  dbDateToBusiness,
  type ActivityMoneyRowDto,
  type ActivityReportDto,
  type ActivityReportQuery,
  type LedgerEntryType,
  type NamedRefDto,
  type PaymentType,
  type ReportSectionDto,
} from '@pallet/shared';
import type { Clock } from '../../common/clock';
import { fromAggregate, toSafeMoney, type SqlAggregate } from '../../common/utils/money';
import { pageSqlLimit, type PageQuery } from '../../common/utils/pagination';
import { Prisma } from '../../generated/prisma/client';
import { ledgerRowsOnEffectiveDate } from '../ledger/effective-date';

type Db = Prisma.TransactionClient;
type Money = bigint | number;

/**
 * The activity report (§12.4, Q99): a period's hand-overs, returns, payments, refunds and compensation.
 * Each section's totals and row count are SQL aggregates over the whole period; its rows are one page
 * (`<section>Page`, `pageSize`), read as keys in the section's order and then hydrated with only what
 * the page shows. With an item filter the money sections are omitted. Every query runs after the one
 * before it: the caller's snapshot is one connection. The caller has checked the period.
 */
export async function queryActivityReport(
  db: Db,
  query: ActivityReportQuery,
  clock: Clock,
): Promise<ActivityReportDto> {
  const scope = activityScope(query);
  const handovers = await handoverSection(db, scope, page(query, query.handoversPage));
  const returns = await returnSection(db, scope, page(query, query.returnsPage));
  const compensation = await compensationSection(db, scope, page(query, query.compensationPage), returns.damagedLines);
  const payments = scope.moneyOmitted
    ? emptyMoneySection(page(query, query.paymentsPage))
    : await moneySection(db, scope, 'PAYMENT', page(query, query.paymentsPage));
  const refunds = scope.moneyOmitted
    ? emptyMoneySection(page(query, query.refundsPage))
    : await moneySection(db, scope, 'REFUND', page(query, query.refundsPage));

  return {
    generatedAt: clock.now().toISOString(),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    filters: {
      customerId: query.customerId ?? null,
      itemId: query.itemId ?? null,
      driverId: query.driverId ?? null,
    },
    moneyOmitted: scope.moneyOmitted,
    handovers: handovers.section,
    returns: returns.section,
    payments: payments.section,
    refunds: refunds.section,
    compensation,
    totals: {
      handoverQuantity: handovers.quantity,
      handoverDepositTotal: handovers.deposit,
      returnedAccepted: returns.accepted,
      returnedDamaged: returns.damaged,
      refundDueTotal: returns.refundDue,
      paymentsGross: payments.gross,
      paymentReversals: payments.reversals,
      paymentsNet: payments.gross - payments.reversals,
      refundsGross: refunds.gross,
      refundReversals: refunds.reversals,
      refundsNet: refunds.gross - refunds.reversals,
      compensationAssessed: returns.compensation,
    },
  };
}

interface ActivityScope {
  from: Date;
  to: Date;
  /** F(o) of §12.4: live orders, through the order's customer and driver. */
  orderFilter: Prisma.Sql;
  /**
   * F(o) for a row that only names its order (a return's `r.order_id`): with no customer or driver, an
   * anti-join on the few cancelled orders' partial index instead of reading every order (Q62).
   */
  orderOf: (orderId: Prisma.Sql) => Prisma.Sql;
  /** The item filter on an order line `ol`, or nothing. */
  lineFilter: Prisma.Sql;
  /** Joins a return line `rl` to its order line `ol` when the item filter needs it. */
  lineJoin: Prisma.Sql;
  query: ActivityReportQuery;
  moneyOmitted: boolean;
}

function activityScope(query: ActivityReportQuery): ActivityScope {
  const orderFilter = Prisma.sql`
      o.cancelled_at IS NULL
      ${query.customerId ? Prisma.sql`AND o.customer_id = ${query.customerId}` : Prisma.empty}
      ${query.driverId ? Prisma.sql`AND o.driver_id = ${query.driverId}` : Prisma.empty}`;
  const throughParty = query.customerId !== undefined || query.driverId !== undefined;
  return {
    from: businessDateToDb(query.dateFrom),
    to: businessDateToDb(query.dateTo),
    orderFilter,
    orderOf: (orderId) =>
      throughParty
        ? Prisma.sql`EXISTS (SELECT 1 FROM orders o WHERE o.id = ${orderId} AND ${orderFilter})`
        : Prisma.sql`NOT EXISTS (SELECT 1 FROM orders c WHERE c.id = ${orderId} AND c.cancelled_at IS NOT NULL)`,
    lineFilter: query.itemId ? Prisma.sql`AND ol.item_id = ${query.itemId}` : Prisma.empty,
    lineJoin: query.itemId ? Prisma.sql`JOIN order_lines ol ON ol.id = rl.order_line_id` : Prisma.empty,
    query,
    moneyOmitted: query.itemId !== undefined,
  };
}

const RETURN_ORDER = Prisma.raw('r.order_id');

function page(query: ActivityReportQuery, pageNumber: number): PageQuery {
  return { page: pageNumber, pageSize: query.pageSize };
}

function section<T>(rows: T[], { page: pageNumber, pageSize }: PageQuery, total: SqlAggregate): ReportSectionDto<T> {
  return { rows, page: pageNumber, pageSize, total: fromAggregate(total) };
}

function named(id: number, name: string): NamedRefDto {
  return { id, name };
}

/** Hand-overs: the period's orders having a line in scope, with those lines. */
async function handoverSection(
  db: Db,
  { orderFilter, lineFilter, from, to }: ActivityScope,
  pageQuery: PageQuery,
): Promise<{ section: ActivityReportDto['handovers']; quantity: number; deposit: number }> {
  const [totals] = await db.$queryRaw<{ orders: SqlAggregate; quantity: SqlAggregate; deposit: SqlAggregate }[]>`
    SELECT COUNT(DISTINCT o.id)::bigint AS orders, SUM(ol.quantity)::bigint AS quantity,
           SUM(ol.line_total)::bigint AS deposit
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id
     WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date ${lineFilter}`;
  const keys = await db.$queryRaw<
    {
      id: number;
      order_number: number;
      date: Date;
      payment_type: PaymentType;
      customer_id: number;
      customer_name: string;
      driver_id: number;
      driver_name: string;
    }[]
  >`
    SELECT o.id, o.order_number, o.date, o.payment_type::text AS payment_type,
           c.id AS customer_id, c.name AS customer_name, d.id AS driver_id, d.name AS driver_name
      FROM (
        SELECT o.id, o.date, o.created_at FROM orders o
         WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date
           AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id ${lineFilter})
         ORDER BY o.date ASC, o.created_at ASC, o.id ASC ${pageSqlLimit(pageQuery)}
      ) k
      JOIN orders o ON o.id = k.id JOIN customers c ON c.id = o.customer_id JOIN drivers d ON d.id = o.driver_id
     ORDER BY k.date ASC, k.created_at ASC, k.id ASC`;
  const ids = keys.map((key) => key.id);
  const lines = ids.length
    ? await db.$queryRaw<
        { order_id: number; item_id: number; item_name: string; quantity: number; line_total: Money }[]
      >`
        SELECT ol.order_id, ol.item_id, i.name AS item_name, ol.quantity, ol.line_total
          FROM order_lines ol JOIN items i ON i.id = ol.item_id
         WHERE ol.order_id = ANY(${ids}::int[]) ${lineFilter}
         ORDER BY ol.id ASC`
    : [];

  const rows = keys.map((key) => {
    const own = lines.filter((line) => line.order_id === key.id);
    return {
      orderId: key.id,
      orderNumber: key.order_number,
      date: dbDateToBusiness(key.date),
      customer: named(key.customer_id, key.customer_name),
      driver: named(key.driver_id, key.driver_name),
      paymentType: key.payment_type,
      lines: own.map((line) => ({ item: named(line.item_id, line.item_name), quantity: line.quantity })),
      quantity: own.reduce((total, line) => total + line.quantity, 0),
      depositTotal: own.reduce((total, line) => total + toSafeMoney(line.line_total), 0),
    };
  });
  return {
    section: section(rows, pageQuery, totals?.orders ?? 0),
    quantity: fromAggregate(totals?.quantity ?? 0),
    deposit: fromAggregate(totals?.deposit ?? 0),
  };
}

/** Returns: the period's live returns having a line in scope, summed over those lines. */
async function returnSection(
  db: Db,
  { orderOf, lineFilter, lineJoin, from, to, query }: ActivityScope,
  pageQuery: PageQuery,
): Promise<{
  section: ActivityReportDto['returns'];
  accepted: number;
  damaged: number;
  refundDue: number;
  compensation: number;
  /** The compensation section's row count: the damaged lines among these. */
  damagedLines: SqlAggregate;
}> {
  const [totals] = await db.$queryRaw<
    {
      returns: SqlAggregate;
      accepted: SqlAggregate;
      damaged: SqlAggregate;
      refund_due: SqlAggregate;
      compensation: SqlAggregate;
      damaged_lines: SqlAggregate;
    }[]
  >`
    SELECT COUNT(DISTINCT r.id)::bigint AS returns,
           SUM(rl.accepted_quantity)::bigint AS accepted, SUM(rl.damaged_quantity)::bigint AS damaged,
           SUM(rl.accepted_quantity * rl.unit_deposit + rl.damaged_refund)::bigint AS refund_due,
           SUM(rl.damaged_quantity * rl.unit_deposit - rl.damaged_refund)::bigint AS compensation,
           COUNT(*) FILTER (WHERE rl.damaged_quantity > 0)::bigint AS damaged_lines
      FROM returns r
      JOIN return_lines rl ON rl.return_id = r.id ${lineJoin}
     WHERE r.reversed_at IS NULL AND r.date BETWEEN ${from}::date AND ${to}::date
       AND ${orderOf(RETURN_ORDER)} ${lineFilter}`;
  const keys = await db.$queryRaw<
    {
      id: number;
      order_id: number;
      order_number: number;
      date: Date;
      cash_refund: Money;
      customer_id: number;
      customer_name: string;
    }[]
  >`
    SELECT r.id, r.order_id, o.order_number, r.date, r.cash_refund, c.id AS customer_id, c.name AS customer_name
      FROM (
        SELECT r.id, r.date, r.created_at FROM returns r
         WHERE r.reversed_at IS NULL AND r.date BETWEEN ${from}::date AND ${to}::date
           AND ${orderOf(RETURN_ORDER)}
           AND EXISTS (SELECT 1 FROM return_lines rl ${lineJoin} WHERE rl.return_id = r.id ${lineFilter})
         ORDER BY r.date ASC, r.created_at ASC, r.id ASC ${pageSqlLimit(pageQuery)}
      ) k
      JOIN returns r ON r.id = k.id JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = o.customer_id
     ORDER BY k.date ASC, k.created_at ASC, k.id ASC`;
  const ids = keys.map((key) => key.id);
  const sums = ids.length
    ? await db.$queryRaw<{ return_id: number; accepted: SqlAggregate; damaged: SqlAggregate; credit: SqlAggregate }[]>`
        SELECT rl.return_id, SUM(rl.accepted_quantity)::bigint AS accepted, SUM(rl.damaged_quantity)::bigint AS damaged,
               SUM(rl.accepted_quantity * rl.unit_deposit + rl.damaged_refund)::bigint AS credit
          FROM return_lines rl ${lineJoin}
         WHERE rl.return_id = ANY(${ids}::int[]) ${lineFilter}
         GROUP BY rl.return_id`
    : [];
  const byReturn = new Map(sums.map((sum) => [sum.return_id, sum]));

  const rows = keys.map((key) => {
    const sum = byReturn.get(key.id);
    return {
      returnId: key.id,
      orderId: key.order_id,
      orderNumber: key.order_number,
      date: dbDateToBusiness(key.date),
      customer: named(key.customer_id, key.customer_name),
      acceptedQuantity: fromAggregate(sum?.accepted ?? 0),
      damagedQuantity: fromAggregate(sum?.damaged ?? 0),
      // Over the lines counted: with an item filter, the credit that item's lines gave.
      refundDue: fromAggregate(sum?.credit ?? 0),
      // Cash is paid per return, not per item: with an item filter it is not the item's to show.
      cashRefund: query.itemId === undefined ? toSafeMoney(key.cash_refund) : 0,
    };
  });
  return {
    section: section(rows, pageQuery, totals?.returns ?? 0),
    accepted: fromAggregate(totals?.accepted ?? 0),
    damaged: fromAggregate(totals?.damaged ?? 0),
    refundDue: fromAggregate(totals?.refund_due ?? 0),
    compensation: fromAggregate(totals?.compensation ?? 0),
    damagedLines: totals?.damaged_lines ?? 0,
  };
}

/** Compensation assessed: one row per damaged line of the period's live returns. */
async function compensationSection(
  db: Db,
  { orderOf, lineFilter, lineJoin, from, to }: ActivityScope,
  pageQuery: PageQuery,
  total: SqlAggregate,
): Promise<ActivityReportDto['compensation']> {
  const lines = await db.$queryRaw<
    {
      id: number;
      return_id: number;
      order_number: number;
      date: Date;
      customer_id: number;
      customer_name: string;
      item_id: number;
      item_name: string;
      damaged_quantity: number;
      unit_deposit: Money;
      damaged_refund: Money;
    }[]
  >`
    SELECT rl.id, rl.return_id, o.order_number, r.date, c.id AS customer_id, c.name AS customer_name,
           i.id AS item_id, i.name AS item_name, rl.damaged_quantity, rl.unit_deposit, rl.damaged_refund
      FROM (
        SELECT rl.id, r.date, r.created_at
          FROM returns r
          JOIN return_lines rl ON rl.return_id = r.id ${lineJoin}
         WHERE r.reversed_at IS NULL AND r.date BETWEEN ${from}::date AND ${to}::date AND rl.damaged_quantity > 0
           AND ${orderOf(RETURN_ORDER)} ${lineFilter}
         ORDER BY r.date ASC, r.created_at ASC, rl.id ASC ${pageSqlLimit(pageQuery)}
      ) k
      JOIN return_lines rl ON rl.id = k.id
      JOIN returns r ON r.id = rl.return_id
      JOIN orders o ON o.id = r.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN order_lines ol ON ol.id = rl.order_line_id
      JOIN items i ON i.id = ol.item_id
     ORDER BY k.date ASC, k.created_at ASC, k.id ASC`;

  const rows = lines.map((line) => {
    const damagedRefund = toSafeMoney(line.damaged_refund);
    return {
      returnLineId: line.id,
      returnId: line.return_id,
      orderNumber: line.order_number,
      date: dbDateToBusiness(line.date),
      customer: named(line.customer_id, line.customer_name),
      item: named(line.item_id, line.item_name),
      damagedQuantity: line.damaged_quantity,
      damagedRefund,
      compensation: line.damaged_quantity * toSafeMoney(line.unit_deposit) - damagedRefund,
    };
  });
  return section(rows, pageQuery, total);
}

interface MoneySection {
  section: ReportSectionDto<ActivityMoneyRowDto>;
  gross: number;
  reversals: number;
}

function emptyMoneySection(pageQuery: PageQuery): MoneySection {
  return { section: section([], pageQuery, 0), gross: 0, reversals: 0 };
}

/**
 * Payments or refunds with their reversals, on the effective date (Q98's two indexable halves, which
 * the section's order and page cut reach into), and the gross and reversed sums over the whole period.
 */
async function moneySection(
  db: Db,
  { query, from, to }: ActivityScope,
  kind: 'PAYMENT' | 'REFUND',
  pageQuery: PageQuery,
): Promise<MoneySection> {
  const types: LedgerEntryType[] = kind === 'PAYMENT' ? ['PAYMENT', 'PAYMENT_REVERSAL'] : ['REFUND', 'REFUND_REVERSAL'];
  const orderConditions = [
    ...(query.customerId ? [Prisma.sql`o.customer_id = ${query.customerId}`] : []),
    ...(query.driverId ? [Prisma.sql`o.driver_id = ${query.driverId}`] : []),
  ];
  const scope = { liveOrdersOnly: true, orderConditions, types, dateFrom: from, dateTo: to };
  const orderBy = Prisma.sql`effective_date ASC, entry_created_at ASC, entry_id ASC`;

  const [totals] = await db.$queryRaw<{ rows: SqlAggregate; gross: SqlAggregate; reversals: SqlAggregate }[]>`
    SELECT COUNT(*)::bigint AS rows,
           COALESCE(SUM(entry_amount) FILTER (WHERE entry_type::text = ${kind}), 0)::bigint AS gross,
           COALESCE(SUM(entry_amount) FILTER (WHERE entry_type::text <> ${kind}), 0)::bigint AS reversals
      FROM (${ledgerRowsOnEffectiveDate(scope)}) rows`;
  const keys = await db.$queryRaw<{ id: number; effective_date: Date }[]>`
    SELECT entry_id AS id, effective_date
      FROM (${ledgerRowsOnEffectiveDate(scope, { orderBy, limit: pageQuery.page * pageQuery.pageSize })}) rows
     ORDER BY ${orderBy} ${pageSqlLimit(pageQuery)}`;
  const ids = keys.map((key) => key.id);
  const entries = ids.length
    ? await db.$queryRaw<
        {
          id: number;
          order_id: number;
          order_number: number;
          customer_id: number;
          customer_name: string;
          type: LedgerEntryType;
          amount: Money;
          reverses_entry_id: number | null;
        }[]
      >`
        SELECT le.id, le.order_id, o.order_number, c.id AS customer_id, c.name AS customer_name,
               le.type::text AS type, le.amount, le.reverses_entry_id
          FROM ledger_entries le JOIN orders o ON o.id = le.order_id JOIN customers c ON c.id = o.customer_id
         WHERE le.id = ANY(${ids}::int[])`
    : [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rows = keys.flatMap((key) => {
    const entry = byId.get(key.id);
    if (!entry) return [];
    return [
      {
        id: entry.id,
        orderId: entry.order_id,
        orderNumber: entry.order_number,
        date: dbDateToBusiness(key.effective_date),
        customer: named(entry.customer_id, entry.customer_name),
        type: entry.type,
        amount: toSafeMoney(entry.amount),
        reversesEntryId: entry.reverses_entry_id,
      },
    ];
  });
  return {
    section: section(rows, pageQuery, totals?.rows ?? 0),
    gross: fromAggregate(totals?.gross ?? 0),
    reversals: fromAggregate(totals?.reversals ?? 0),
  };
}
