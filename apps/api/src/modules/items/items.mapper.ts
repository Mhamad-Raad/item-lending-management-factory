import type { ItemDto, StockMovementDto, StockMovementReason } from '@pallet/shared';
import { toSafeMoney } from '../../common/utils/money';
import type { Item, Upload } from '../../generated/prisma/client';
import { uploadUrl } from '../uploads/uploads.mapper';

export type ItemRow = Item & { image: Pick<Upload, 'fileName'> | null };

/** Computed on read from orders and returns (§4.6): never stored, so never out of date. */
export interface ItemDerived {
  quantityOut: number;
  damagedTotal: number;
}

/** What an item with no orders and no returns has. */
export const NO_ACTIVITY: ItemDerived = { quantityOut: 0, damagedTotal: 0 };

export function toItemDto(row: ItemRow, derived: ItemDerived): ItemDto {
  return {
    id: row.id,
    name: row.name,
    imageUploadId: row.imageUploadId,
    imageUrl: row.image ? uploadUrl(row.image.fileName) : null,
    depositPrice: toSafeMoney(row.depositPrice),
    quantityOnHand: row.quantityOnHand,
    minStock: row.minStock,
    isLowStock: row.minStock !== null && row.quantityOnHand <= row.minStock,
    quantityOut: derived.quantityOut,
    damagedTotal: derived.damagedTotal,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One ledger row as the stock-movement query returns it, already in the DTO's words. */
export interface StockMovementRow {
  id: number;
  itemId: number;
  quantity: number;
  reason: StockMovementReason;
  batchId: number | null;
  orderId: number | null;
  orderNumber: number | null;
  returnId: number | null;
  note: string | null;
  createdAt: Date;
  balanceAfter: number;
  userId: number;
  username: string;
  displayName: string;
}

export function toStockMovementDto(row: StockMovementRow): StockMovementDto {
  const { userId, username, displayName, createdAt, ...movement } = row;
  return { ...movement, createdAt: createdAt.toISOString(), createdBy: { id: userId, username, displayName } };
}
