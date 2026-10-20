import { z } from 'zod';
import { BusinessDate, Id, Money, NonNegQuantity, optionalText } from './common.js';

/** One order line of a return (§6.20): pallets accepted back into stock, pallets damaged, and what is refunded for the damaged ones. */
export const ReturnLineInput = z.strictObject({
  orderLineId: Id,
  acceptedQuantity: NonNegQuantity,
  damagedQuantity: NonNegQuantity,
  damagedRefund: Money.default(0),
});
export type ReturnLineInput = z.infer<typeof ReturnLineInput>;

/** Drops the entries that return nothing, as `ReturnCreateBody` does (Q41). */
const returningLines = z
  .array(ReturnLineInput)
  .max(50)
  .transform((lines) =>
    lines.filter((line) => line.acceptedQuantity + line.damagedQuantity > 0 || line.damagedRefund > 0),
  );

/**
 * A return, or the replacement of one (§6.20). An entry that returns nothing — no pallet accepted or
 * damaged and no refund — is dropped rather than refused (Q41), so a form may send every line of the
 * order; when nothing is left the service answers `RETURN_EMPTY`.
 */
export const ReturnCreateBody = z.strictObject({
  date: BusinessDate,
  notes: optionalText(1000),
  lines: returningLines,
});
export type ReturnCreateBody = z.infer<typeof ReturnCreateBody>;

export const ReturnReplaceBody = ReturnCreateBody;
export type ReturnReplaceBody = ReturnCreateBody;

/**
 * A return of a customer's pallets across their open orders (§6.20, Q156): one date and note, and for each order
 * the lines that came back. The service records a return on each order that has a line left, all or none; an order
 * named twice is a field error.
 */
export const CustomerReturnCreateBody = z.strictObject({
  date: BusinessDate,
  notes: optionalText(1000),
  orders: z
    .array(z.strictObject({ orderId: Id, lines: returningLines }))
    .max(100)
    .superRefine((orders, ctx) => {
      const seen = new Set<number>();
      orders.forEach((order, index) => {
        if (seen.has(order.orderId)) {
          ctx.addIssue({ code: 'custom', path: [index, 'orderId'], params: { code: 'duplicate' } });
        }
        seen.add(order.orderId);
      });
    })
    .transform((orders) => orders.filter((order) => order.lines.length > 0)),
});
export type CustomerReturnCreateBody = z.infer<typeof CustomerReturnCreateBody>;
