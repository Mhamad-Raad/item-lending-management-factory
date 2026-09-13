import { returnMoney, returnRefundDue, type ReturnCreateBody } from '@pallet/shared';
import { ApiError } from '../../common/errors/api-error';

/** An order line as a return is checked against it: its price, and how many of its pallets are still out. */
export interface ReturnableLine {
  id: number;
  itemId: number;
  unitDeposit: number;
  outQuantity: number;
}

/** A return entry priced with its line's stored deposit. */
export interface PricedReturnLine {
  orderLineId: number;
  itemId: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  unitDeposit: number;
  damagedRefund: number;
}

/**
 * `validateReturnAgainstOrder` of §6.20, run under the order lock against the order state the return
 * applies to — for an edit, the order without the return being replaced. The date's lower bounds are
 * checked here; the caller has already refused a date after today.
 */
export function validateReturnAgainstOrder(
  order: { date: string; lines: readonly ReturnableLine[] },
  body: ReturnCreateBody,
): PricedReturnLine[] {
  if (body.lines.length === 0) throw new ApiError('RETURN_EMPTY');

  const seen = new Set<number>();
  for (const entry of body.lines) {
    if (seen.has(entry.orderLineId)) throw new ApiError('RETURN_DUPLICATE_LINE', { orderLineId: entry.orderLineId });
    seen.add(entry.orderLineId);
  }

  const lines = new Map(order.lines.map((line) => [line.id, line]));
  const priced = body.lines.map((entry) => {
    const line = lines.get(entry.orderLineId);
    if (!line) throw new ApiError('RETURN_LINE_NOT_IN_ORDER', { orderLineId: entry.orderLineId });
    return { entry, line };
  });

  if (body.date < order.date) throw new ApiError('RETURN_DATE_BEFORE_ORDER_DATE', { orderDate: order.date });

  for (const { entry, line } of priced) {
    const maximum = entry.damagedQuantity * line.unitDeposit;
    if (entry.damagedRefund > maximum) {
      throw new ApiError('DAMAGED_REFUND_TOO_HIGH', { orderLineId: entry.orderLineId, maximum });
    }
  }

  const over = priced
    .filter(({ entry, line }) => entry.acceptedQuantity + entry.damagedQuantity > line.outQuantity)
    .map(({ entry, line }) => ({
      orderLineId: entry.orderLineId,
      requested: entry.acceptedQuantity + entry.damagedQuantity,
      outQuantity: line.outQuantity,
    }));
  if (over.length > 0) throw new ApiError('RETURN_EXCEEDS_OUT', { lines: over });

  return priced.map(({ entry, line }) => ({
    orderLineId: entry.orderLineId,
    itemId: line.itemId,
    acceptedQuantity: entry.acceptedQuantity,
    damagedQuantity: entry.damagedQuantity,
    unitDeposit: line.unitDeposit,
    damagedRefund: entry.damagedRefund,
  }));
}

/** §4.3: what the return credits, and how much of it is paid out because it exceeds what was owed. */
export function priceReturn(lines: readonly PricedReturnLine[], owedBefore: number) {
  const refundDue = returnRefundDue(lines);
  return { refundDue, owedBefore, cashRefund: returnMoney(owedBefore, refundDue).cashRefund };
}
