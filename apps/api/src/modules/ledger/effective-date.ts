import type { LedgerEntryType } from '@pallet/shared';
import { Prisma } from '../../generated/prisma/client';

/**
 * Which money-ledger rows to read, on their effective date (§6.21): the row's own `date`, or — for the
 * automatic hand-over payment, the only row stored without one — its order's.
 */
export interface LedgerRowScope {
  /** Leave out the rows of cancelled orders. */
  liveOrdersOnly: boolean;
  /** Conditions on the row's order, as `o` (customer, driver). */
  orderConditions?: Prisma.Sql[];
  /** Conditions on the row itself, as `le` (its order id). */
  rowConditions?: Prisma.Sql[];
  types?: readonly LedgerEntryType[];
  /** Inclusive effective-date bounds, as PostgreSQL dates. */
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * A page cut inside each half: its `ORDER BY` names the output columns (`entry_id`, `effective_date`,
 * `entry_created_at`, `entry_amount`) and must end in `entry_id`, and `limit` is the outer offset plus
 * the page size, so each half hands over no more rows than the page can reach.
 */
export interface LedgerRowCut {
  orderBy: Prisma.Sql;
  limit: number;
}

/**
 * The scope's rows as `entry_id, effective_date, entry_created_at, entry_amount, entry_type` (Q98): a
 * `UNION ALL` of the dated rows, read by their own date from `ledger_entries (date, id)`, and the
 * automatic payments, read by their order's date from `orders (date)` and the partial index of undated
 * rows. `COALESCE(le.date, o.date)` gave the same rows but no index can serve it, so every filter or
 * sort on it read the whole ledger and probed an order per row. The automatic payment is a PAYMENT
 * (`ledger_entries_automatic_only_payment_check`), so a type filter without PAYMENT skips its half.
 */
export function ledgerRowsOnEffectiveDate(scope: LedgerRowScope, cut?: LedgerRowCut): Prisma.Sql {
  const halves = [datedHalf(scope, cut)];
  if (!scope.types || scope.types.includes('PAYMENT')) halves.push(undatedHalf(scope, cut));
  return Prisma.join(halves, ' UNION ALL ');
}

const COLUMNS = Prisma.sql`le.created_at AS entry_created_at, le.amount AS entry_amount, le.type AS entry_type`;

function datedHalf(scope: LedgerRowScope, cut: LedgerRowCut | undefined): Prisma.Sql {
  const orderConditions = scope.orderConditions ?? [];
  const joinsOrder = orderConditions.length > 0;
  const conditions = [Prisma.sql`le.date IS NOT NULL`, ...rowConditions(scope), ...orderConditions];
  if (scope.dateFrom) conditions.push(Prisma.sql`le.date >= ${scope.dateFrom}::date`);
  if (scope.dateTo) conditions.push(Prisma.sql`le.date <= ${scope.dateTo}::date`);
  if (scope.liveOrdersOnly) {
    // Without a join, as an anti-join on the few cancelled orders' partial index (Q62).
    conditions.push(
      joinsOrder
        ? Prisma.sql`o.cancelled_at IS NULL`
        : Prisma.sql`NOT EXISTS (SELECT 1 FROM orders c WHERE c.id = le.order_id AND c.cancelled_at IS NOT NULL)`,
    );
  }
  return withCut(
    Prisma.sql`SELECT le.id AS entry_id, le.date AS effective_date, ${COLUMNS}
      FROM ledger_entries le ${joinsOrder ? Prisma.sql`JOIN orders o ON o.id = le.order_id` : Prisma.empty}
     WHERE ${Prisma.join(conditions, ' AND ')}`,
    cut,
  );
}

function undatedHalf(scope: LedgerRowScope, cut: LedgerRowCut | undefined): Prisma.Sql {
  const conditions = [...rowConditions(scope), ...(scope.orderConditions ?? [])];
  if (scope.dateFrom) conditions.push(Prisma.sql`o.date >= ${scope.dateFrom}::date`);
  if (scope.dateTo) conditions.push(Prisma.sql`o.date <= ${scope.dateTo}::date`);
  if (scope.liveOrdersOnly) conditions.push(Prisma.sql`o.cancelled_at IS NULL`);
  return withCut(
    Prisma.sql`SELECT le.id AS entry_id, o.date AS effective_date, ${COLUMNS}
      FROM orders o JOIN ledger_entries le ON le.order_id = o.id AND le.date IS NULL
     ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}`,
    cut,
  );
}

function rowConditions(scope: LedgerRowScope): Prisma.Sql[] {
  const conditions = [...(scope.rowConditions ?? [])];
  // The enum compared as the enum, so the (type, date) index applies; `type::text` hid it.
  if (scope.types) conditions.push(Prisma.sql`le.type = ANY(${[...scope.types]}::ledger_entry_type[])`);
  return conditions;
}

function withCut(half: Prisma.Sql, cut: LedgerRowCut | undefined): Prisma.Sql {
  return cut ? Prisma.sql`(${half} ORDER BY ${cut.orderBy} LIMIT ${cut.limit})` : Prisma.sql`(${half})`;
}
