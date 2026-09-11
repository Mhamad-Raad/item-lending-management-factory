import { Injectable } from '@nestjs/common';
import { businessDayRangeToUtc, type AuditLogDto, type AuditLogListQuery, type PageDto } from '@pallet/shared';
import { ApiError } from '../../common/errors/api-error';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuditLogDto } from './audit.mapper';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogListQuery, canViewCost: boolean): Promise<PageDto<AuditLogDto>> {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new ApiError('DATE_RANGE_INVALID', { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }

    const createdAt = businessDayRangeToUtc(query.dateFrom, query.dateTo);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
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
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toAuditLogDto(row, canViewCost)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
