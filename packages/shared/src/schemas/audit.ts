import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../enums.js';
import { IdParam, dateRange } from './common.js';

/**
 * The history counts up to this many matching entries and says "10,000+" beyond (Q100): counting all of
 * a decade's history on every page view read the whole table.
 */
export const AUDIT_COUNT_LIMIT = 10_000;

/**
 * The last history page (Q100): the newest 10,000 entries at the page's 50 rows. Older entries are reached
 * by narrowing the dates, not by walking an ever deeper `OFFSET`.
 */
export const AUDIT_PAGE_MAX = 200;

/** `GET /api/audit-logs` (§6.25): newest first, 50 to a page. */
export const AuditLogListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: IdParam.optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().max(64).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  ...dateRange,
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuery>;
