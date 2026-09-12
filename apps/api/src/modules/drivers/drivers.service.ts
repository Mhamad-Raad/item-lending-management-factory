import { Injectable } from '@nestjs/common';
import type { DriverCreateBody, DriverDto, DriverListQuery, DriverUpdateBody, PageDto } from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { escapeLikePattern, phoneSearchPattern } from '../../common/utils/search';
import { parseSort } from '../../common/utils/sort';
import type { Prisma } from '../../generated/prisma/client';
import { lockDriver } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { pickSnapshot, toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { toDriverDto } from './drivers.mapper';

const SORT_FIELDS = { name: 'name', createdAt: 'createdAt' } as const;
const EDITABLE_FIELDS = ['name', 'phone', 'carNumber'] as const;

/** Drivers (§6.18) are references, not snapshots: an order shows its driver's current details. */
@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(query: DriverListQuery): Promise<PageDto<DriverDto>> {
    const phone = query.q ? phoneSearchPattern(query.q) : undefined;
    const where: Prisma.DriverWhereInput = {
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.q
        ? {
            OR: [
              { name: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
              { carNumber: { contains: escapeLikePattern(query.q), mode: 'insensitive' } },
              ...(phone ? [{ phone: { contains: phone } }] : []),
            ],
          }
        : {}),
    };
    const { field, direction } = parseSort<keyof typeof SORT_FIELDS>(query.sort);

    const [total, rows] = await Promise.all([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        orderBy: [{ [SORT_FIELDS[field]]: direction }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toDriverDto), page: query.page, pageSize: query.pageSize, total };
  }

  /** Archived drivers are returned too: an old order still names its driver. */
  async get(driverId: number): Promise<DriverDto> {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new ApiError('DRIVER_NOT_FOUND', { driverId });
    return toDriverDto(driver);
  }

  create(body: DriverCreateBody, actor: AuthContext): Promise<DriverDto> {
    return this.prisma.$transaction(async (tx) => {
      const driver = await tx.driver.create({ data: { ...body, createdByUserId: actor.userId } });
      await this.audit.record(tx, {
        action: 'CREATE',
        entityType: 'DRIVER',
        entityId: String(driver.id),
        summaryParams: { name: driver.name },
        after: toAuditSnapshot('DRIVER', driver),
      });
      return toDriverDto(driver);
    });
  }

  update(driverId: number, body: DriverUpdateBody): Promise<DriverDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockDriver(tx, driverId);
      const before = await tx.driver.findUnique({ where: { id: driverId } });
      if (!before) throw new ApiError('DRIVER_NOT_FOUND', { driverId });
      if (before.archivedAt) throw new ApiError('DRIVER_ARCHIVED', { driverId });
      if (before.version !== body.version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });

      const changed = EDITABLE_FIELDS.filter((field) => body[field] !== undefined && body[field] !== before[field]);
      // Q37: a save that changes nothing writes nothing — no version bump, no history row.
      if (changed.length === 0) return toDriverDto(before);

      const after = await tx.driver.update({
        where: { id: driverId },
        data: { name: body.name, phone: body.phone, carNumber: body.carNumber, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'DRIVER',
        entityId: String(driverId),
        summaryParams: { name: after.name, fields: changed },
        before: pickSnapshot(toAuditSnapshot('DRIVER', before), changed),
        after: pickSnapshot(toAuditSnapshot('DRIVER', after), changed),
      });
      return toDriverDto(after);
    });
  }

  /** Always an archive, allowed at any time: open orders keep referring to the driver. */
  archive(driverId: number, version: number, actor: AuthContext): Promise<DriverDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockDriver(tx, driverId);
      const before = await tx.driver.findUnique({ where: { id: driverId } });
      if (!before) throw new ApiError('DRIVER_NOT_FOUND', { driverId });
      if (before.archivedAt) throw new ApiError('DRIVER_ALREADY_ARCHIVED', { driverId });
      if (before.version !== version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });

      const after = await tx.driver.update({
        where: { id: driverId },
        data: { archivedAt: this.clock.now(), archivedByUserId: actor.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'DELETE',
        entityType: 'DRIVER',
        entityId: String(driverId),
        summaryParams: { name: after.name },
        before: toAuditSnapshot('DRIVER', before),
        after: toAuditSnapshot('DRIVER', after),
      });
      return toDriverDto(after);
    });
  }
}
