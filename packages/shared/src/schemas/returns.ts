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

/**
 * A return, or the replacement of one (§6.20). An entry that returns nothing — no pallet accepted or
 * damaged and no refund — is dropped rather than refused (Q41), so a form may send every line of the
 * order; when nothing is left the service answers `RETURN_EMPTY`.
 */
export const ReturnCreateBody = z.strictObject({
  date: BusinessDate,
  notes: optionalText(1000),
  lines: z
    .array(ReturnLineInput)
    .max(50)
    .transform((lines) =>
      lines.filter((line) => line.acceptedQuantity + line.damagedQuantity > 0 || line.damagedRefund > 0),
    ),
});
export type ReturnCreateBody = z.infer<typeof ReturnCreateBody>;

export const ReturnReplaceBody = ReturnCreateBody;
export type ReturnReplaceBody = ReturnCreateBody;
