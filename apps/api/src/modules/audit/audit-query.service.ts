import { Injectable } from '@nestjs/common';
import {
  AUDIT_COUNT_LIMIT,
  AUDIT_ENTITY_TYPES,
  AUDIT_ENTITY_VIEW_PERMISSION,
  businessDayRangeToUtc,
  visibleAuditEntityTypes,
  type AuditLogDto,
  type AuditLogListQuery,
  type PageDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { ApiError } from '../../common/errors/api-error';
import { pageArgs, toPage } from '../../common/utils/pagination';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditLogDto } from './audit.mapper';

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.AuditLogOrderByWithRelationInput[];

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the rows of what the viewer may otherwise see (Q73); cost is redacted as before. */
  async list(query: AuditLogListQuery, viewer: AuthContext): Promise<PageDto<AuditLogDto>> {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new ApiError('DATE_RANGE_INVALID', { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }

    const visible = visibleAuditEntityTypes((key) => viewer.permissions.has(key));
    if (query.entityType && !visible.includes(query.entityType)) {
      throw new ApiError('PERMISSION_DENIED', { required: [AUDIT_ENTITY_VIEW_PERMISSION[query.entityType]] });
    }
    // Every type visible (an admin): no filter at all, so the query plan stays what it was.
    const entityType = query.entityType ?? (visible.length === AUDIT_ENTITY_TYPES.length ? undefined : { in: visible });

    const createdAt = businessDayRangeToUtc(query.dateFrom, query.dateTo);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [counted, page] = await Promise.all([
      // Q100: counting stops one past the limit, which then reads "10,000+". Prisma cuts the count in id order
      // unless told otherwise, walking from the oldest row; by time, every filter's index serves the cut.
      this.prisma.auditLog.count({ where, take: AUDIT_COUNT_LIMIT + 1, orderBy: { createdAt: 'desc' } }),
      // The page's ids first, from the index alone, then only those rows: the deep pages no longer read
      // every skipped row from the table (a deferred join, Q100).
      this.prisma.auditLog.findMany({
        where,
        select: { id: true },
        // Fixed order (§6.24): newest first — by time, then id (Q100). In id order alone, a period from years
        // ago made the database walk every newer row's id before reaching it (0.75 s at ten years).
        orderBy: NEWEST_FIRST,
        ...pageArgs(query),
      }),
    ]);
    const rows = await this.prisma.auditLog.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: { user: { select: { id: true, username: true, displayName: true } } },
      orderBy: NEWEST_FIRST,
    });

    const items = rows.map((row) => toAuditLogDto(row, viewer.canViewCost));
    return counted > AUDIT_COUNT_LIMIT
      ? { ...toPage(items, query, counted), totalIsLowerBound: true }
      : toPage(items, query, counted);
  }
}
