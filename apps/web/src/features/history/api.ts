import type { AuditLogDto } from '@pallet/shared';
import { pageQuery, type ListParams } from '@/lib/page-query';
import { qk } from '@/lib/query-keys';

export function auditLogListQuery(params: ListParams) {
  return pageQuery<AuditLogDto>(qk.audit.list(params), '/audit-logs', params);
}
