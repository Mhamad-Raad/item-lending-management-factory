import type { DriverDto } from '@pallet/shared';
import type { Driver } from '../../generated/prisma/client';

export function toDriverDto(row: Driver): DriverDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    carNumber: row.carNumber,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
