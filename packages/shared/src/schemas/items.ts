import { z } from 'zod';
import { QUANTITY_INPUT_MAX } from '../domain/ledger-math.js';
import { STOCK_MOVEMENT_REASONS } from '../enums.js';
import {
  AT_LEAST_ONE_FIELD_ERROR,
  BoolQuery,
  BusinessDate,
  Id,
  Money,
  Name200,
  NonNegQuantity,
  PageQuery,
  Quantity,
  SearchQuery,
  Version,
  hasFieldBesidesVersion,
  optionalText,
  sortParam,
} from './common.js';

export const ItemListQuery = z.strictObject({
  ...PageQuery,
  q: SearchQuery,
  includeArchived: BoolQuery.default(false),
  lowStockOnly: BoolQuery.default(false),
  sort: sortParam(['name', 'quantityOnHand', 'depositPrice', 'createdAt'], 'name'),
});
export type ItemListQuery = z.infer<typeof ItemListQuery>;

/** The item's first delivery, recorded with it in one step (§6.15). Needs `purchases.create`. */
export const InitialBatchBody = z.strictObject({
  date: BusinessDate,
  quantity: Quantity,
  unitCost: Money,
  note: optionalText(500),
});
export type InitialBatchBody = z.infer<typeof InitialBatchBody>;

export const ItemCreateBody = z.strictObject({
  name: Name200,
  depositPrice: Money,
  minStock: NonNegQuantity.nullable().default(null),
  imageUploadId: Id.nullable().default(null),
  initialBatch: InitialBatchBody.optional(),
});
export type ItemCreateBody = z.infer<typeof ItemCreateBody>;

export const ItemUpdateBody = z
  .strictObject({
    version: Version,
    name: Name200.optional(),
    depositPrice: Money.optional(),
    minStock: NonNegQuantity.nullable().optional(),
    imageUploadId: Id.nullable().optional(),
  })
  .refine(hasFieldBesidesVersion, AT_LEAST_ONE_FIELD_ERROR);
export type ItemUpdateBody = z.infer<typeof ItemUpdateBody>;

/** A signed correction with its reason: pallets found in the yard, broken ones, a recount. */
export const StockAdjustmentCreateBody = z.strictObject({
  quantity: z
    .number()
    .int()
    .min(-QUANTITY_INPUT_MAX)
    .max(QUANTITY_INPUT_MAX)
    .refine((quantity) => quantity !== 0, { params: { code: 'too_small' } }),
  note: z.string().trim().min(3).max(500),
});
export type StockAdjustmentCreateBody = z.infer<typeof StockAdjustmentCreateBody>;

export const StockMovementListQuery = z.strictObject({
  ...PageQuery,
  reason: z.enum(STOCK_MOVEMENT_REASONS).optional(),
});
export type StockMovementListQuery = z.infer<typeof StockMovementListQuery>;
