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
  .refine(isBusinessDate, { message: 'invalid_date' })
  .refine((v) => v >= MIN_BUSINESS_DATE, { message: 'too_small' });
export type BusinessDate = z.infer<typeof BusinessDate>;

/** `?page=&pageSize=` on every paginated list. */
export const PageQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
