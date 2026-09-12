import { z } from 'zod';
import { PAYMENT_TYPES } from '../enums.js';
import {
  BusinessDate,
  Id,
  IdParam,
  Money,
  PageQuery,
  Quantity,
  SearchQuery,
  dateRange,
  optionalText,
  sortParam,
} from './common.js';

export const OrderLineInput = z.strictObject({ itemId: Id, quantity: Quantity, unitDeposit: Money.optional() });
export type OrderLineInput = z.infer<typeof OrderLineInput>;

/**
 * One line per item (§8.5, Q38): a repeated item is reported on the repeated line's `itemId`, so the
 * form can point at the line to fix.
 */
export const OrderLines = z
  .array(OrderLineInput)
  .min(1)
  .max(50)
  .superRefine((lines, ctx) => {
    const seen = new Set<number>();
    lines.forEach((line, index) => {
      if (seen.has(line.itemId)) {
        ctx.addIssue({ code: 'custom', path: [index, 'itemId'], params: { code: 'duplicate' } });
      }
      seen.add(line.itemId);
    });
  });

export const OrderListQuery = z.strictObject({
  ...PageQuery,
  status: z.enum(['OPEN', 'SETTLED', 'CANCELLED', 'ALL']).default('OPEN'),
  customerId: IdParam.optional(),
  driverId: IdParam.optional(),
  /** Orders having a line for this item. */
  itemId: IdParam.optional(),
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  ...dateRange,
  /** All digits: that order number, or a customer whose name contains them; otherwise the customer name. */
  q: SearchQuery,
  sort: sortParam(['orderNumber', 'date', 'owed', 'outValue'], '-orderNumber'),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

export const OrderCreateBody = z.strictObject({
  customerId: Id,
  driverId: Id,
  date: BusinessDate,
  paymentType: z.enum(PAYMENT_TYPES),
  notes: optionalText(1000),
  lines: OrderLines,
  /** An admin's answer to CREDIT_LIMIT_EXCEEDED: record the order anyway (§4.4). */
  confirmCreditOverride: z.boolean().default(false),
});
export type OrderCreateBody = z.infer<typeof OrderCreateBody>;
