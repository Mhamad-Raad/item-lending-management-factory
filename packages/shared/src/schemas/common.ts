import { z } from 'zod';
import { MONEY_INPUT_MAX, QUANTITY_INPUT_MAX } from '../domain/ledger-math.js';
import { MIN_BUSINESS_DATE, isBusinessDate } from '../dates.js';

/**
 * Shared primitive schemas (naming: ARCHITECTURE.md §6.27 / §8.5 — PascalCase schemas,
 * `type X = z.infer<typeof X>` exported alongside).
 */

/** Positive integer id. */
export const Id = z.number().int().positive();
export type Id = z.infer<typeof Id>;

/** Optimistic-locking version sent back on every update. */
export const Version = z.number().int().positive();
export type Version = z.infer<typeof Version>;

/** Whole IQD amount entered by a user: integer 0..MONEY_INPUT_MAX. */
export const Money = z.number().int().min(0).max(MONEY_INPUT_MAX);
export type Money = z.infer<typeof Money>;

/** Strictly positive whole IQD amount (ledger amounts). */
export const PositiveMoney = z.number().int().min(1).max(MONEY_INPUT_MAX);
export type PositiveMoney = z.infer<typeof PositiveMoney>;

/** Pallet quantity on an order line / batch: integer 1..QUANTITY_INPUT_MAX. */
export const Quantity = z.number().int().min(1).max(QUANTITY_INPUT_MAX);
export type Quantity = z.infer<typeof Quantity>;

/** Business date `YYYY-MM-DD`, not before MIN_BUSINESS_DATE. "Not in the future" is checked by the API. */
export const BusinessDate = z
  .string()
  // Codes travel in `params`, where the issue mapper reads them (§6.3.2); `abort` keeps a string
  // that is not a date at all from also being compared as one.
  .refine(isBusinessDate, { params: { code: 'invalid_date' }, abort: true })
  .refine((v) => v >= MIN_BUSINESS_DATE, { params: { code: 'too_small', params: { minimum: MIN_BUSINESS_DATE } } });
export type BusinessDate = z.infer<typeof BusinessDate>;

/** Path parameter ids arrive as strings, so they are coerced (§6.1.4). */
export const IdParam = z.coerce.number().int().min(1).max(2_147_483_647);
export type IdParam = z.infer<typeof IdParam>;

/** `?page=&pageSize=` on every paginated list; spread into each list query. */
export const PageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
} as const;

/** Free-text search box: trimmed, and an empty box means "no filter" rather than "matches empty". */
export const SearchQuery = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value ? value : undefined));

/** `?sort=field` or `?sort=-field` for descending, restricted to the fields a list supports. */
export function sortParam<F extends string>(fields: readonly F[], fallback: `${'' | '-'}${F}`) {
  const values = [...fields, ...fields.map((field) => `-${field}`)] as [string, ...string[]];
  return z.enum(values).default(fallback);
}

/** `?dateFrom=&dateTo=`; the ordering of the two is checked by the endpoint (`DATE_RANGE_INVALID`). */
export const dateRange = {
  dateFrom: BusinessDate.optional(),
  dateTo: BusinessDate.optional(),
} as const;

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
