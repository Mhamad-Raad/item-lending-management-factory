import { Prisma, type Item } from '../../generated/prisma/client';

/**
 * The low-stock rule (A12): an item with a minimum is low once its stock is at or below it; an item
 * without one never is. Where the question is "what needs restocking" — the dashboard and the stock
 * report (§12.5) — an archived item is never low, because it is no longer restocked; the item itself
 * (its DTO, the items list's filter) still reports the plain comparison.
 */
export function isLowStock(
  item: Pick<Item, 'minStock' | 'quantityOnHand' | 'archivedAt'>,
  { archivedNeverLow }: { archivedNeverLow: boolean },
): boolean {
  if (archivedNeverLow && item.archivedAt !== null) return false;
  return item.minStock !== null && item.quantityOnHand <= item.minStock;
}

/** `isLowStock(item, { archivedNeverLow: true })` over `items i` in raw SQL. */
export const LOW_STOCK_SQL = Prisma.sql`i.archived_at IS NULL AND i.min_stock IS NOT NULL AND i.quantity_on_hand <= i.min_stock`;

/**
 * `isLowStock(item, { archivedNeverLow: false })` as a Prisma filter: the stock compared with the
 * item's own minimum through Prisma's field reference (`prisma.item.fields.minStock`), not a literal.
 * Whether archived items are listed at all is the caller's filter.
 */
export function lowStockWhere(minStock: Prisma.FieldRef<'Item', 'Int'>): Prisma.ItemWhereInput {
  return { minStock: { not: null }, quantityOnHand: { lte: minStock } };
}
