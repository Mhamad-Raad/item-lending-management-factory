import { dbDateToBusiness, type PurchaseBatchDto } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Item, PurchaseBatch, User } from '../../generated/prisma/client';
import { toAuditSnapshot } from '../audit/audit-snapshot';

export type BatchRow = PurchaseBatch & {
  item: Pick<Item, 'name'>;
  createdBy: Pick<User, 'id' | 'username' | 'displayName'>;
};

/** Cost is omitted — not null — for a viewer without `items.viewCost` (§6.9). */
export function toPurchaseBatchDto(row: BatchRow, canViewCost: boolean): PurchaseBatchDto {
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.item.name,
    date: dbDateToBusiness(row.date),
    quantity: row.quantity,
    ...(canViewCost ? { unitCost: toSafeMoney(row.unitCost), totalCost: toSafeMoney(row.totalCost) } : {}),
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: { id: row.createdBy.id, username: row.createdBy.username, displayName: row.createdBy.displayName },
  };
}

/** A batch's audit snapshot, cost included: it is stripped on read for viewers who may not see it (§11.5). */
export function batchAuditSnapshot(batch: PurchaseBatch, itemName: string): Record<string, unknown> {
  return toAuditSnapshot('PURCHASE_BATCH', { ...batch, itemName });
}
