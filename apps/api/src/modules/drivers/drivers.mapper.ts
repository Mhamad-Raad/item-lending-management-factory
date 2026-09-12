import type { DriverDto, DriverRefDto } from '@pallet/shared';
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

/** How an order names its driver: the driver's current details, not a copy (§6.18). */
export function toDriverRef(driver: Driver): DriverRefDto {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    carNumber: driver.carNumber,
    archived: driver.archivedAt !== null,
  };
}
