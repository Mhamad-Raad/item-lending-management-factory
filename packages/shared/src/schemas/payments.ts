import { z } from 'zod';
import { LEDGER_ENTRY_TYPES, type LedgerEntryType } from '../enums.js';
import {
  BoolQuery,
  BusinessDate,
  IdParam,
  PageQuery,
  PositiveMoney,
  dateRange,
  optionalText,
  sortParam,
} from './common.js';

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

/** A comma list of ledger entry types (`PAYMENT,PAYMENT_REVERSAL`); absent means every type. */
const LedgerTypeList = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()))
  .pipe(z.array(z.enum(LEDGER_ENTRY_TYPES)).min(1))
  .transform((types) => [...new Set(types)] as LedgerEntryType[]);

export const LedgerEntryListQuery = z.strictObject({
  ...PageQuery,
  customerId: IdParam.optional(),
  orderId: IdParam.optional(),
  type: LedgerTypeList.optional(),
  /** On the effective date: the row's own, or its order's for the automatic payment. */
  ...dateRange,
  includeCancelledOrders: BoolQuery.default(false),
  sort: sortParam(['effectiveDate', 'createdAt', 'amount'], '-effectiveDate'),
});
export type LedgerEntryListQuery = z.infer<typeof LedgerEntryListQuery>;
