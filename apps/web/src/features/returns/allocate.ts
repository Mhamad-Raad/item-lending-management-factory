import type { CustomerReturnableDto, ItemRefDto } from '@pallet/shared';
import type { TypedRow } from './return-rows';

/** One order line still out, as an item's holding lists it (Q160). */
export interface HeldLine {
  orderId: number;
  orderNumber: number;
  orderDate: string;
  orderLineId: number;
  outQuantity: number;
  unitDeposit: number;
}

/** Everything the customer still holds of one item, over all their open orders, its lines oldest first (Q160). */
export interface ItemHolding {
  item: ItemRefDto;
  outQuantity: number;
  lines: HeldLine[];
}

/** What one order line takes of an item's typed row. */
export interface LineShare extends HeldLine {
  accepted: number;
  damaged: number;
  damagedRefund: number;
}

/** Oldest first (Q160): the order's date, then its number for two orders of one day. */
function byDateThenNumber(dateA: string, numberA: number, dateB: string, numberB: number): number {
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  return numberA - numberB;
}

/** Oldest order first (Q160), as its lines are placed. */
export function olderOrderFirst(
  a: { date: string; orderNumber: number },
  b: { date: string; orderNumber: number },
): number {
  return byDateThenNumber(a.date, a.orderNumber, b.date, b.orderNumber);
}

/** Oldest line first: its order's, then the line for two lines of one order. */
function olderFirst(a: HeldLine, b: HeldLine): number {
  return byDateThenNumber(a.orderDate, a.orderNumber, b.orderDate, b.orderNumber) || a.orderLineId - b.orderLineId;
}

/**
 * The customer's holdings by item (Q160): one entry per item, whatever orders and deposits it went out on, in the
 * order its oldest line went out.
 */
export function itemHoldings(data: CustomerReturnableDto): ItemHolding[] {
  const byItem = new Map<number, ItemHolding>();
  for (const order of data.orders) {
    for (const line of order.lines) {
      const holding = byItem.get(line.item.id) ?? { item: line.item, outQuantity: 0, lines: [] };
      holding.outQuantity += line.outQuantity;
      holding.lines.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderDate: order.date,
        orderLineId: line.id,
        outQuantity: line.outQuantity,
        unitDeposit: line.unitDeposit,
      });
      byItem.set(line.item.id, holding);
    }
  }
  const holdings = [...byItem.values()];
  for (const holding of holdings) holding.lines.sort(olderFirst);
  return holdings.sort((a, b) => olderFirst(a.lines[0] as HeldLine, b.lines[0] as HeldLine));
}

/** An order dated after the return takes nothing back: its pallets had not gone out yet on that day (Q160). */
export function isOrderAfterReturn(orderDate: string, returnDate: string | null): boolean {
  return returnDate !== null && orderDate > returnDate;
}

/** A line of an order dated after the return (`isOrderAfterReturn`). */
export function isAfterReturn(line: HeldLine, returnDate: string | null): boolean {
  return isOrderAfterReturn(line.orderDate, returnDate);
}

/** What an item has out on orders dated on or before the return date (all of it while no date is chosen). */
export function outBy(lines: readonly HeldLine[], returnDate: string | null): number {
  return lines.reduce((total, line) => total + (isAfterReturn(line, returnDate) ? 0 : line.outQuantity), 0);
}

/**
 * Splits an item's typed row over its lines, oldest first (Q160): the damaged pallets first, then the accepted ones,
 * each line taking what it still has out; the damage refund follows the damaged pallets, each line taking at most
 * the deposit of its own damaged ones. An order dated after the return date takes nothing (a return cannot precede
 * its order). What the lines cannot take (a row over what is out) is left unplaced: such a row is refused as typed
 * and prices nothing. With `previous` — a return being edited (Q174) — each line first takes back what it had, so an
 * unchanged count stays on the orders it was on; only the rest is placed oldest first.
 */
export function allocate(
  lines: readonly HeldLine[],
  row: TypedRow,
  returnDate: string | null = null,
  previous?: ReadonlyMap<number, TypedRow>,
): LineShare[] {
  let damagedLeft = row.damaged;
  let acceptedLeft = row.accepted;
  let refundLeft = row.damagedRefund;
  const shares = lines.map((line) => ({ ...line, accepted: 0, damaged: 0, damagedRefund: 0 }));
  const place = (cap: (share: LineShare) => TypedRow): void => {
    for (const share of shares) {
      if (isAfterReturn(share, returnDate)) continue;
      const limit = cap(share);
      const damaged = Math.min(share.outQuantity - share.damaged - share.accepted, limit.damaged, damagedLeft);
      share.damaged += damaged;
      damagedLeft -= damaged;
      const accepted = Math.min(share.outQuantity - share.damaged - share.accepted, limit.accepted, acceptedLeft);
      share.accepted += accepted;
      acceptedLeft -= accepted;
      const damagedRefund = Math.min(
        share.damaged * share.unitDeposit - share.damagedRefund,
        limit.damagedRefund,
        refundLeft,
      );
      share.damagedRefund += damagedRefund;
      refundLeft -= damagedRefund;
    }
  };
  const any = Number.MAX_SAFE_INTEGER;
  if (previous) {
    place((share) => previous.get(share.orderLineId) ?? { accepted: 0, damaged: 0, damagedRefund: 0 });
  }
  place(() => ({ accepted: any, damaged: any, damagedRefund: any }));
  return shares;
}

/** The most an item's damage refund can give back: the deposit of its damaged pallets where they were placed. */
export function refundMaximum(shares: readonly LineShare[]): number {
  return shares.reduce((total, share) => total + share.damaged * share.unitDeposit, 0);
}
