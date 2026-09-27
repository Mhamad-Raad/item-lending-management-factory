import { Injectable } from '@nestjs/common';
import {
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

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, username: true, displayName: true } } },
        // Fixed order (§6.24): newest first, and `id` alone is enough — it is monotonic.
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
    ]);

    return toPage(
      rows.map((row) => toAuditLogDto(row, viewer.canViewCost)),
      query,
      total,
    );
  }
}
