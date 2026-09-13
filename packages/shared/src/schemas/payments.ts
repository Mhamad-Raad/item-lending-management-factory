import { z } from 'zod';
import { BusinessDate, PositiveMoney, optionalText } from './common.js';

/** A manual payment on a credit order (§6.21). */
export const PaymentCreateBody = z.strictObject({
  date: BusinessDate,
  amount: PositiveMoney,
  note: optionalText(500),
});
export type PaymentCreateBody = z.infer<typeof PaymentCreateBody>;

/** Deleting a manual payment writes its reversal; the note says why (§6.21). */
export const LedgerEntryReverseBody = z.strictObject({ note: optionalText(500) });
export type LedgerEntryReverseBody = z.infer<typeof LedgerEntryReverseBody>;
