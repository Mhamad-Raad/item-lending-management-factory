import {
  computeOrderTotals,
  orderStateWithoutReturn,
  returnMoney,
  returnRefundDue,
  type OrderDetailDto,
  type OrderState,
  type OrderTotals,
} from '@pallet/shared';

/** The order as the section 4 formulas read it, from the detail the page already has (§7.4). */
export function orderStateOf(order: OrderDetailDto): OrderState {
  return {
    cancelled: order.cancelledAt !== null,
    lines: order.lines.map((line) => ({ id: line.id, quantity: line.quantity, unitDeposit: line.unitDeposit })),
    returns: order.returns.map((pr) => ({
      reversed: pr.reversed,
      lines: pr.lines.map((line) => ({
        orderLineId: line.orderLineId,
        acceptedQuantity: line.acceptedQuantity,
        damagedQuantity: line.damagedQuantity,
        damagedRefund: line.damagedRefund,
      })),
    })),
    ledger: order.ledgerEntries.map((entry) => ({ type: entry.type, amount: entry.amount })),
  };
}

/**
 * The state a return is recorded against (§7.4.2): the order as it stands, or — when replacing a return
 * — the order as if that return had been reversed, its cash refund reversed with it.
 */
export function returnBaseline(order: OrderDetailDto, replaceReturnId?: number): OrderTotals {
  const state = orderStateOf(order);
  const index = replaceReturnId === undefined ? -1 : order.returns.findIndex((pr) => pr.id === replaceReturnId);
  if (index === -1) return computeOrderTotals(state);
  // The same rule as the API: the refund row the return paid out, while it still stands.
  const refund = order.ledgerEntries.find(
    (entry) => entry.type === 'REFUND' && entry.returnId === replaceReturnId && !entry.isReversed,
  );
  return computeOrderTotals(orderStateWithoutReturn(state, index, refund?.amount ?? 0));
}

export interface ReturnRow {
  acceptedQuantity: number;
  damagedQuantity: number;
  damagedRefund: number;
  unitDeposit: number;
}

/** The live summary of a return being typed (§7.4.2), from the shared formulas only. */
export function returnSummary(base: OrderTotals, rows: readonly ReturnRow[]) {
  const refundDue = returnRefundDue(rows);
  const owedBefore = base.owed;
  const { cashRefund, owedAfter } = returnMoney(owedBefore, refundDue);
  const returning = rows.reduce((total, row) => total + row.acceptedQuantity + row.damagedQuantity, 0);
  return {
    refundDue,
    owedBefore,
    cashRefund,
    owedAfter,
    outAfter: base.outQuantityTotal - returning,
    compensation: rows.reduce((total, row) => total + row.damagedQuantity * row.unitDeposit - row.damagedRefund, 0),
  };
}
