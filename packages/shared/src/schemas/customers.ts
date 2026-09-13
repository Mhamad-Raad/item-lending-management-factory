import { z } from 'zod';
import { CUSTOMER_HISTORY_KINDS, type CustomerHistoryKind } from '../enums.js';
import {
  AT_LEAST_ONE_FIELD_ERROR,
  BoolQuery,
  IdParam,
  Money,
  Name200,
  PageQuery,
  Phone,
  SearchQuery,
  Version,
  dateRange,
  hasFieldBesidesVersion,
  sortParam,
} from './common.js';

const Address = z.string().trim().min(1).max(300);

/** A second number must be a second number (§6.17). */
const DIFFERENT_PHONES_ERROR = { path: ['altPhone'], params: { code: 'duplicate' } };

export const CustomerListQuery = z.strictObject({
  ...PageQuery,
  /** Matches the name, and the phone and second number as normalised input. */
  q: SearchQuery,
  includeArchived: BoolQuery.default(false),
  hasOpenOrders: BoolQuery.optional(),
  sort: sortParam(['name', 'palletsOut', 'outValue', 'owed', 'held', 'createdAt'], 'name'),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

export const CustomerPhoneCheckQuery = z.strictObject({ phone: Phone, excludeId: IdParam.optional() });
export type CustomerPhoneCheckQuery = z.infer<typeof CustomerPhoneCheckQuery>;

export const CustomerCreateBody = z
  .strictObject({
    name: Name200,
    phone: Phone,
    altPhone: Phone.nullable().default(null),
    address: Address,
    /** null = no limit; 0 = may take nothing. */
    creditLimit: Money.nullable(),
    /** Set once the user has seen the duplicate-phone warning and saves anyway (A13). */
    confirmDuplicatePhone: z.boolean().default(false),
  })
  .refine((body) => body.altPhone !== body.phone, DIFFERENT_PHONES_ERROR);
export type CustomerCreateBody = z.infer<typeof CustomerCreateBody>;

/**
 * The phones are compared here when both are sent; the API compares the resulting pair when only one
 * is. `confirmDuplicatePhone` is a flag, not a change, so it does not satisfy "at least one field".
 */
export const CustomerUpdateBody = z
  .strictObject({
    version: Version,
    name: Name200.optional(),
    phone: Phone.optional(),
    altPhone: Phone.nullable().optional(),
    address: Address.optional(),
    creditLimit: Money.nullable().optional(),
    confirmDuplicatePhone: z.boolean().default(false),
  })
  .refine((body) => hasFieldBesidesVersion({ ...body, confirmDuplicatePhone: undefined }), AT_LEAST_ONE_FIELD_ERROR)
  .refine(
    (body) => body.phone === undefined || body.altPhone === undefined || body.altPhone !== body.phone,
    DIFFERENT_PHONES_ERROR,
  );
export type CustomerUpdateBody = z.infer<typeof CustomerUpdateBody>;

/**
 * A customer's timeline (§6.17): `kinds` is a comma list of HANDOVER, RETURN, LEDGER (absent = all);
 * the dates filter on each entry's own date — a ledger row's effective date.
 */
export const CustomerHistoryQuery = z.strictObject({
  ...PageQuery,
  kinds: z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()))
    .pipe(z.array(z.enum(CUSTOMER_HISTORY_KINDS)).min(1))
    .transform((kinds) => [...new Set(kinds)] as CustomerHistoryKind[])
    .optional(),
  includeCancelled: BoolQuery.default(false),
  ...dateRange,
});
export type CustomerHistoryQuery = z.infer<typeof CustomerHistoryQuery>;
