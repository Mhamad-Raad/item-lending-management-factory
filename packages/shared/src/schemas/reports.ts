import { z } from 'zod';
import { BoolQuery, BusinessDate, IdParam, PAGE_MAX, sortParam } from './common.js';

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

/** The largest page an activity-report section sends (Q99): a printable page, never a whole year. */
export const ACTIVITY_PAGE_SIZE_MAX = 500;

/** The activity report's sections, each paged on its own (Q99). */
export const ACTIVITY_SECTIONS = ['handovers', 'returns', 'payments', 'refunds', 'compensation'] as const;
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];

const SectionPage = z.coerce.number().int().min(1).max(PAGE_MAX).default(1);

/**
 * Report 3 (§6.23): customer and driver filter through the order; an item filter leaves money out. Each
 * section has its own page (`handoversPage` …) of `pageSize` rows; the totals always cover the period.
 */
export const ActivityReportQuery = z.strictObject({
  dateFrom: BusinessDate,
  dateTo: BusinessDate,
  customerId: IdParam.optional(),
  itemId: IdParam.optional(),
  driverId: IdParam.optional(),
  handoversPage: SectionPage,
  returnsPage: SectionPage,
  paymentsPage: SectionPage,
  refundsPage: SectionPage,
  compensationPage: SectionPage,
  pageSize: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_SIZE_MAX).default(100),
});
export type ActivityReportQuery = z.infer<typeof ActivityReportQuery>;

/** Report 4, a snapshot (§6.23). */
export const StockReportQuery = z.strictObject({
  includeArchived: BoolQuery.default(false),
  lowStockOnly: BoolQuery.default(false),
  sort: sortParam(['name', 'quantityOnHand', 'quantityOut', 'damagedTotal'], 'name'),
});
export type StockReportQuery = z.infer<typeof StockReportQuery>;
