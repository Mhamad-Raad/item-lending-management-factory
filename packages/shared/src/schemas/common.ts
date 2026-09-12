import { z } from 'zod';
import { MONEY_INPUT_MAX, QUANTITY_INPUT_MAX } from '../domain/ledger-math.js';
import { PHONE_PATTERN } from '../constants.js';
import { MIN_BUSINESS_DATE, isBusinessDate } from '../dates.js';
import { normalizePhone } from '../format.js';

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

/** A count that may be zero: a minimum stock level, a quantity returned. */
export const NonNegQuantity = z.number().int().min(0).max(QUANTITY_INPUT_MAX);
export type NonNegQuantity = z.infer<typeof NonNegQuantity>;

/** A required name: trimmed, then 1–200 characters. */
export const Name200 = z.string().trim().min(1).max(200);

/** A phone number, validated and stored normalised (Q13): Western digits, no spaces, dashes or parentheses. */
export const Phone = z.string().max(40).transform(normalizePhone).pipe(z.string().regex(PHONE_PATTERN));

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

/**
 * Optional free text: trimmed, and an empty box is stored as null. Absent stays undefined, so a
 * PATCH can tell "leave it" from "clear it".
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === '' || value === null ? null : value));
}

/** `?flag=true` / `?flag=false` and nothing else (§6.1.3). */
export const BoolQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** `?version=N` on a DELETE, which has no body to carry it. */
export const VersionQuery = z.strictObject({ version: z.coerce.number().int().min(1) });
export type VersionQuery = z.infer<typeof VersionQuery>;

/** A PATCH must change something: at least one field besides `version` (§6.1.4). */
export function hasFieldBesidesVersion(body: Record<string, unknown>): boolean {
  return Object.entries(body).some(([key, value]) => key !== 'version' && value !== undefined);
}

/** The object-level error for that rule: `required` at the root of the body. */
export const AT_LEAST_ONE_FIELD_ERROR = { path: [] as PropertyKey[], params: { code: 'required' } };

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
