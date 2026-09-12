import { z } from 'zod';
import {
  AT_LEAST_ONE_FIELD_ERROR,
  BusinessDate,
  Id,
  IdParam,
  Money,
  PageQuery,
  Quantity,
  Version,
  dateRange,
  hasFieldBesidesVersion,
  optionalText,
  sortParam,
} from './common.js';

/** Sorting by cost is not offered: the list is readable without `items.viewCost` (§6.16). */
export const PurchaseBatchListQuery = z.strictObject({
  ...PageQuery,
  itemId: IdParam.optional(),
  ...dateRange,
  sort: sortParam(['date', 'quantity', 'createdAt'], '-date'),
});
export type PurchaseBatchListQuery = z.infer<typeof PurchaseBatchListQuery>;

export const PurchaseBatchCreateBody = z.strictObject({
  itemId: Id,
  date: BusinessDate,
  quantity: Quantity,
  unitCost: Money,
  note: optionalText(500),
});
export type PurchaseBatchCreateBody = z.infer<typeof PurchaseBatchCreateBody>;

/** The item of a batch never changes; to move stock to another item, delete and re-enter. */
export const PurchaseBatchUpdateBody = z
  .strictObject({
    version: Version,
    date: BusinessDate.optional(),
    quantity: Quantity.optional(),
    unitCost: Money.optional(),
    note: optionalText(500),
  })
  .refine(hasFieldBesidesVersion, AT_LEAST_ONE_FIELD_ERROR);
export type PurchaseBatchUpdateBody = z.infer<typeof PurchaseBatchUpdateBody>;
