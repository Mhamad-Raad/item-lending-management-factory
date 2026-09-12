import { LedgerInvariantError, computeOrderTotals } from '@pallet/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { toSafeMoney } from '../common/utils/money';
import { ORDER_STATE_INCLUDE, toOrderState } from '../modules/orders/order-state';

export interface Discrepancy {
  entity: 'item' | 'order' | 'orderLine' | 'orderCounter' | 'batch' | 'return';
  id: number;
  field: string;
  stored: number | string;
  expected: number | string;
}

/**
 * The reconciliation of §4.9, R1–R7: every maintained total recomputed from the ledgers, and every
 * cross-row invariant the ledgers must keep. An empty result means the database is consistent.
 */
export async function findLedgerDiscrepancies(prisma: PrismaClient): Promise<Discrepancy[]> {
  const out: Discrepancy[] = [];

  const stock = await prisma.$queryRaw<{ id: number; stored: number; expected: bigint }[]>`
    SELECT i.id, i.quantity_on_hand AS stored, COALESCE(SUM(sm.quantity), 0)::bigint AS expected
    FROM items i
    LEFT JOIN stock_movements sm ON sm.item_id = i.id
    GROUP BY i.id, i.quantity_on_hand
    ORDER BY i.id`;
  for (const row of stock) {
    const expected = Number(row.expected);
    if (row.stored !== expected) {
      out.push({ entity: 'item', id: row.id, field: 'quantityOnHand', stored: row.stored, expected });
    }
  }

  const orders = await prisma.order.findMany({
    orderBy: { id: 'asc' },
    include: ORDER_STATE_INCLUDE,
  });

  for (const order of orders) {
    let totals;
    try {
      totals = computeOrderTotals(toOrderState(order));
    } catch (error) {
      // Data that breaks the formulas themselves (owed below zero, more returned than handed over) is
      // exactly what reconciliation exists to report — never a reason to stop checking the others.
      if (!(error instanceof LedgerInvariantError)) throw error;
      out.push({
        entity: 'order',
        id: order.id,
        field: 'invariant',
        stored: error.message,
        expected: 'consistent ledger',
      });
      continue;
    }

    const orderFields = {
      status: order.status,
      depositTotal: toSafeMoney(order.depositTotal),
      paymentsNet: toSafeMoney(order.paymentsNet),
      creditsTotal: toSafeMoney(order.creditsTotal),
      refundsNet: toSafeMoney(order.refundsNet),
      owed: toSafeMoney(order.owed),
      outQuantityTotal: order.outQuantityTotal,
      outValue: toSafeMoney(order.outValue),
      held: toSafeMoney(order.held),
      compensation: toSafeMoney(order.compensation),
    } as const;
    for (const [field, stored] of Object.entries(orderFields)) {
      const expected = totals[field as keyof typeof orderFields];
      if (stored !== expected) out.push({ entity: 'order', id: order.id, field, stored, expected });
    }

    order.lines.forEach((line, i) => {
      const expected = totals.lines[i]!;
      const lineFields = {
        returnedAccepted: line.returnedAccepted,
        returnedDamaged: line.returnedDamaged,
        outQuantity: line.outQuantity,
      } as const;
      for (const [field, stored] of Object.entries(lineFields)) {
        const exp = expected[field as keyof typeof lineFields];
        if (stored !== exp) out.push({ entity: 'orderLine', id: line.id, field, stored, expected: exp });
      }
    });
  }

  out.push(...(await findInvariantBreaks(prisma)));
  return out;
}

/** R3–R7: the invariants between rows that no single maintained column shows. */
async function findInvariantBreaks(prisma: PrismaClient): Promise<Discrepancy[]> {
  const out: Discrepancy[] = [];

  // R3 (I6): a live cash order has one standing automatic payment of its deposit, and no manual one.
  const cash = await prisma.$queryRaw<
    { id: number; deposit: bigint; automaticCount: number; automaticAmount: bigint; manualCount: number }[]
  >`
    SELECT o.id, o.deposit_total AS deposit,
           COUNT(p.id) FILTER (WHERE p.is_automatic AND r.id IS NULL)::int AS "automaticCount",
           COALESCE(SUM(p.amount) FILTER (WHERE p.is_automatic AND r.id IS NULL), 0)::bigint AS "automaticAmount",
           COUNT(p.id) FILTER (WHERE p.source = 'MANUAL')::int AS "manualCount"
    FROM orders o
    LEFT JOIN ledger_entries p ON p.order_id = o.id AND p.type = 'PAYMENT'
    LEFT JOIN ledger_entries r ON r.reverses_entry_id = p.id
    WHERE o.payment_type = 'CASH' AND o.cancelled_at IS NULL
    GROUP BY o.id, o.deposit_total
    ORDER BY o.id`;
  for (const row of cash) {
    const deposit = toSafeMoney(row.deposit);
    const stored = `${row.automaticCount} × ${toSafeMoney(row.automaticAmount)}`;
    const expected = deposit > 0 ? `1 × ${deposit}` : '0 × 0';
    if (stored !== expected) out.push({ entity: 'order', id: row.id, field: 'automaticPayments', stored, expected });
    if (row.manualCount > 0) {
      out.push({ entity: 'order', id: row.id, field: 'manualPayments', stored: row.manualCount, expected: 0 });
    }
  }

  // R4 (I7): a cancelled order has nothing standing — no return, no payment — and its stock came back.
  const cancelled = await prisma.$queryRaw<
    { id: number; standingReturns: number; paymentsNet: bigint; unbalancedItems: number }[]
  >`
    SELECT o.id,
           (SELECT COUNT(*) FROM returns pr WHERE pr.order_id = o.id AND pr.reversed_at IS NULL)::int
             AS "standingReturns",
           (SELECT COALESCE(SUM(CASE le.type WHEN 'PAYMENT' THEN le.amount WHEN 'PAYMENT_REVERSAL' THEN -le.amount
                                              ELSE 0 END), 0)
              FROM ledger_entries le WHERE le.order_id = o.id)::bigint AS "paymentsNet",
           (SELECT COUNT(*) FROM (SELECT sm.item_id FROM stock_movements sm WHERE sm.order_id = o.id
                                  GROUP BY sm.item_id HAVING SUM(sm.quantity) <> 0) unbalanced)::int
             AS "unbalancedItems"
    FROM orders o
    WHERE o.cancelled_at IS NOT NULL
    ORDER BY o.id`;
  for (const row of cancelled) {
    if (row.standingReturns > 0) {
      out.push({ entity: 'order', id: row.id, field: 'cancelledReturns', stored: row.standingReturns, expected: 0 });
    }
    const paymentsNet = toSafeMoney(row.paymentsNet);
    if (paymentsNet !== 0) {
      out.push({ entity: 'order', id: row.id, field: 'cancelledPayments', stored: paymentsNet, expected: 0 });
    }
    if (row.unbalancedItems > 0) {
      out.push({ entity: 'order', id: row.id, field: 'cancelledStock', stored: row.unbalancedItems, expected: 0 });
    }
  }

  // R5 (I8): order numbers are exactly 1..last_number.
  const [numbers] = await prisma.$queryRaw<{ count: number; min: number | null; max: number | null; last: number }[]>`
    SELECT COUNT(o.id)::int AS count, MIN(o.order_number) AS min, MAX(o.order_number) AS max,
           (SELECT last_number FROM order_counter WHERE id = 1) AS last
    FROM orders o`;
  if (numbers) {
    const stored = `${numbers.count} in ${numbers.min ?? '-'}..${numbers.max ?? '-'}`;
    const expected = numbers.last === 0 ? '0 in -..-' : `${numbers.last} in 1..${numbers.last}`;
    if (stored !== expected) out.push({ entity: 'orderCounter', id: 1, field: 'orderNumbers', stored, expected });
  }

  // R6 (I9): a batch's movements add up to its quantity, or to nothing once it is deleted.
  const batches = await prisma.$queryRaw<{ id: number; expected: number; moved: bigint }[]>`
    SELECT b.id, CASE WHEN b.deleted_at IS NULL THEN b.quantity ELSE 0 END AS expected,
           COALESCE(SUM(sm.quantity), 0)::bigint AS moved
    FROM purchase_batches b
    LEFT JOIN stock_movements sm ON sm.batch_id = b.id
    GROUP BY b.id, b.quantity, b.deleted_at
    ORDER BY b.id`;
  for (const row of batches) {
    const moved = Number(row.moved);
    if (moved !== row.expected) {
      out.push({ entity: 'batch', id: row.id, field: 'movements', stored: moved, expected: row.expected });
    }
  }

  // R7 (I10): a return with a cash refund has exactly one REFUND row of it, reversed or not; without, none.
  const returns = await prisma.$queryRaw<{ id: number; cashRefund: bigint; refunds: number; refunded: bigint }[]>`
    SELECT pr.id, pr.cash_refund AS "cashRefund", COUNT(le.id)::int AS refunds,
           COALESCE(SUM(le.amount), 0)::bigint AS refunded
    FROM returns pr
    LEFT JOIN ledger_entries le ON le.return_id = pr.id AND le.type = 'REFUND'
    GROUP BY pr.id, pr.cash_refund
    ORDER BY pr.id`;
  for (const row of returns) {
    const cashRefund = toSafeMoney(row.cashRefund);
    const stored = `${row.refunds} × ${toSafeMoney(row.refunded)}`;
    const expected = cashRefund > 0 ? `1 × ${cashRefund}` : '0 × 0';
    if (stored !== expected) out.push({ entity: 'return', id: row.id, field: 'refund', stored, expected });
  }

  return out;
}
