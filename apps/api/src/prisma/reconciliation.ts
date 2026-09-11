import { computeOrderTotals } from '@pallet/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { toSafeMoney } from '../common/utils/money';

export interface Discrepancy {
  entity: 'item' | 'order' | 'orderLine';
  id: number;
  field: string;
  stored: number | string;
  expected: number | string;
}

/**
 * Recomputes every maintained running total from the ledgers and reports differences:
 * items.quantity_on_hand vs Σ stock_movements, and every maintained order / order-line column vs
 * computeOrderTotals(). An empty result means the database is consistent.
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
    include: {
      lines: { orderBy: { id: 'asc' } },
      returns: { include: { lines: true } },
      ledgerEntries: { select: { type: true, amount: true } },
    },
  });

  for (const order of orders) {
    const totals = computeOrderTotals({
      cancelled: order.cancelledAt !== null,
      lines: order.lines.map((l) => ({ id: l.id, quantity: l.quantity, unitDeposit: toSafeMoney(l.unitDeposit) })),
      returns: order.returns.map((r) => ({
        reversed: r.reversedAt !== null,
        lines: r.lines.map((rl) => ({
          orderLineId: rl.orderLineId,
          acceptedQuantity: rl.acceptedQuantity,
          damagedQuantity: rl.damagedQuantity,
          damagedRefund: toSafeMoney(rl.damagedRefund),
        })),
      })),
      ledger: order.ledgerEntries.map((e) => ({ type: e.type, amount: toSafeMoney(e.amount) })),
    });

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

  return out;
}
