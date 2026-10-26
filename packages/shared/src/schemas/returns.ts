import { z } from 'zod';
import {
  BusinessDate,
  Id,
  IdParam,
  Money,
  NonNegQuantity,
  Quantity,
  PageQuery,
  SearchQuery,
  dateRange,
  optionalText,
  sortParam,
} from './common.js';

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

/** The most orders one customer return names (Q156): a fuller save would near the API's 100 KB body limit. */
export const CUSTOMER_RETURN_MAX_ORDERS = 100;

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
    .max(CUSTOMER_RETURN_MAX_ORDERS)
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
  /**
   * Pallets of an item beyond everything the customer has out of it (Q170): no deposit, owed to them from now on. An
   * item named here must come back in full on its orders in this same return.
   */
  surplus: z
    .array(z.strictObject({ itemId: Id, quantity: Quantity }))
    .max(50)
    .superRefine((rows, ctx) => {
      const seen = new Set<number>();
      rows.forEach((row, index) => {
        if (seen.has(row.itemId)) {
          ctx.addIssue({ code: 'custom', path: [index, 'itemId'], params: { code: 'duplicate' } });
        }
        seen.add(row.itemId);
      });
    })
    .default([]),
});
export type CustomerReturnCreateBody = z.infer<typeof CustomerReturnCreateBody>;

/**
 * A return edited from the returns list (Q174): what the customer screen sends, with the extra pallets it reopened as
 * still owed when it opened, so a save after some of them went out since is refused rather than counted twice.
 */
export const CustomerReturnReplaceBody = CustomerReturnCreateBody.extend({
  reopened: z
    .array(z.strictObject({ itemId: Id, quantity: Quantity }))
    .max(50)
    .default([]),
});
export type CustomerReturnReplaceBody = z.infer<typeof CustomerReturnReplaceBody>;

/** Pallets the factory owed a customer, handed back to them (Q170). */
export const PalletCreditHandBackBody = z.strictObject({
  itemId: Id,
  quantity: Quantity,
  date: BusinessDate,
  note: optionalText(500),
});
export type PalletCreditHandBackBody = z.infer<typeof PalletCreditHandBackBody>;

/** The returns list (Q168): every return, standing or corrected or deleted, newest first. */
export const ReturnListQuery = z.strictObject({
  ...PageQuery,
  customerId: IdParam.optional(),
  orderId: IdParam.optional(),
  /** Returns that took back this pallet type. */
  itemId: IdParam.optional(),
  ...dateRange,
  /** All digits: that order number, or a customer whose name contains them; otherwise the customer name. */
  q: SearchQuery,
  sort: sortParam(['id', 'date', 'refundDue', 'cashRefund'], '-id'),
});
export type ReturnListQuery = z.infer<typeof ReturnListQuery>;
