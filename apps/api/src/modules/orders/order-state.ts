import { computeOrderTotals, type OrderState, type OrderTotals } from '@pallet/shared';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import type { Prisma } from '../../generated/prisma/client';

/** Everything an order's totals depend on: its lines, its returns with their lines, its ledger rows. */
export const ORDER_STATE_INCLUDE = {
  lines: { orderBy: { id: 'asc' } },
  returns: { include: { lines: true } },
  ledgerEntries: { select: { type: true, amount: true } },
} as const satisfies Prisma.OrderInclude;

export type OrderWithLedgers = Prisma.OrderGetPayload<{ include: typeof ORDER_STATE_INCLUDE }>;

/** The stored order as the section 4 formulas read it — the one mapping recompute and reconcile share. */
export function toOrderState(order: OrderWithLedgers): OrderState {
  return {
    cancelled: order.cancelledAt !== null,
    lines: order.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitDeposit: toSafeMoney(line.unitDeposit),
    })),
    returns: order.returns.map((pr) => ({
      reversed: pr.reversedAt !== null,
      lines: pr.lines.map((rl) => ({
        orderLineId: rl.orderLineId,
        acceptedQuantity: rl.acceptedQuantity,
        damagedQuantity: rl.damagedQuantity,
        damagedRefund: toSafeMoney(rl.damagedRefund),
      })),
    })),
    ledger: order.ledgerEntries.map((entry) => ({ type: entry.type, amount: toSafeMoney(entry.amount) })),
  };
}

/**
 * The cache a line is written with, ahead of `recomputeOrder`: nothing is returned yet, so all of it is
 * out. `order_lines_out_quantity_matches_check` holds on every write, so the line cannot wait for the
 * recompute to set it. With `cancelledMark`, the only cache values written outside `recomputeOrder`,
 * and always the ones it would write itself.
 */
export function lineCacheSeed(quantity: number): { outQuantity: number } {
  return { outQuantity: quantity };
}

/**
 * The cancel mark. The status goes with the timestamp — `orders_cancel_consistent_check` refuses one
 * without the other — so it is written here rather than left to `recomputeOrder`, which then writes
 * the same status.
 */
export function cancelledMark(
  at: Date,
  userId: number,
): { cancelledAt: Date; cancelledByUserId: number; status: 'CANCELLED' } {
  return { cancelledAt: at, cancelledByUserId: userId, status: 'CANCELLED' };
}

/**
 * The only writer of the order cache (§4.6): reads everything the totals depend on, applies
 * `computeOrderTotals` from `@pallet/shared`, and writes back the lines that changed and the order.
 * `bumpVersion` is false only inside order creation (§6.5).
 */
export async function recomputeOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  { bumpVersion }: { bumpVersion: boolean },
): Promise<OrderTotals> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_STATE_INCLUDE });
  const totals = computeOrderTotals(toOrderState(order));

  for (const [index, line] of order.lines.entries()) {
    const next = totals.lines[index];
    if (!next) continue;
    const changed =
      line.returnedAccepted !== next.returnedAccepted ||
      line.returnedDamaged !== next.returnedDamaged ||
      line.outQuantity !== next.outQuantity;
    if (changed) {
      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          returnedAccepted: next.returnedAccepted,
          returnedDamaged: next.returnedDamaged,
          outQuantity: next.outQuantity,
        },
      });
    }
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: totals.status,
      depositTotal: toDbMoney(totals.depositTotal),
      paymentsNet: toDbMoney(totals.paymentsNet),
      creditsTotal: toDbMoney(totals.creditsTotal),
      refundsNet: toDbMoney(totals.refundsNet),
      owed: toDbMoney(totals.owed),
      outQuantityTotal: totals.outQuantityTotal,
      outValue: toDbMoney(totals.outValue),
      held: toDbMoney(totals.held),
      compensation: toDbMoney(totals.compensation),
      ...(bumpVersion ? { version: { increment: 1 } } : {}),
    },
  });
  return totals;
}
