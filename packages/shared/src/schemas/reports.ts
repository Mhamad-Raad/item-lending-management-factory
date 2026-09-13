import { z } from 'zod';
import { BoolQuery, BusinessDate, IdParam, sortParam } from './common.js';

/** Report 1, a snapshot (§6.23): the customers still holding pallets or money unless `includeZero`. */
export const PositionsReportQuery = z.strictObject({
  customerId: IdParam.optional(),
  includeZero: BoolQuery.default(false),
  sort: sortParam(['customerName', 'palletsOut', 'outValue', 'owed', 'held'], '-owed'),
});
export type PositionsReportQuery = z.infer<typeof PositionsReportQuery>;

/** Report 2 (§6.23): both ends of the period are required. */
export const PurchasesReportQuery = z.strictObject({
  dateFrom: BusinessDate,
  dateTo: BusinessDate,
  itemId: IdParam.optional(),
});
export type PurchasesReportQuery = z.infer<typeof PurchasesReportQuery>;

/** Report 3 (§6.23): customer and driver filter through the order; an item filter leaves money out. */
export const ActivityReportQuery = z.strictObject({
  dateFrom: BusinessDate,
  dateTo: BusinessDate,
  customerId: IdParam.optional(),
  itemId: IdParam.optional(),
  driverId: IdParam.optional(),
});
export type ActivityReportQuery = z.infer<typeof ActivityReportQuery>;

/** Report 4, a snapshot (§6.23). */
export const StockReportQuery = z.strictObject({
  includeArchived: BoolQuery.default(false),
  lowStockOnly: BoolQuery.default(false),
  sort: sortParam(['name', 'quantityOnHand', 'quantityOut', 'damagedTotal'], 'name'),
});
export type StockReportQuery = z.infer<typeof StockReportQuery>;
