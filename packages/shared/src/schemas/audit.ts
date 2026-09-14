import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../enums.js';
import { IdParam, dateRange } from './common.js';

/** `GET /api/audit-logs` (§6.25): newest first, 50 to a page. */
export const AuditLogListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: IdParam.optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().max(64).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  ...dateRange,
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuery>;
