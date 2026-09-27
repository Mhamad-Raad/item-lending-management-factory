import { describe, expect, it } from 'vitest';
import { isLowStock, LOW_STOCK_SQL } from './low-stock';

const item = (quantityOnHand: number, minStock: number | null, archived = false) => ({
  quantityOnHand,
  minStock,
  archivedAt: archived ? new Date('2026-09-01T00:00:00Z') : null,
});

describe('isLowStock (A12)', () => {
  it('is low at or below the minimum, never without one', () => {
    for (const archivedNeverLow of [false, true]) {
      expect(isLowStock(item(5, 5), { archivedNeverLow })).toBe(true);
      expect(isLowStock(item(4, 5), { archivedNeverLow })).toBe(true);
      expect(isLowStock(item(6, 5), { archivedNeverLow })).toBe(false);
      expect(isLowStock(item(0, null), { archivedNeverLow })).toBe(false);
    }
  });

  it('never counts an archived item where restocking is the question (§12.5)', () => {
    expect(isLowStock(item(0, 5, true), { archivedNeverLow: true })).toBe(false);
    expect(isLowStock(item(0, 5, true), { archivedNeverLow: false })).toBe(true);
  });

  it('says the same in SQL, archived items excluded', () => {
    expect(LOW_STOCK_SQL.sql).toBe(
      'i.archived_at IS NULL AND i.min_stock IS NOT NULL AND i.quantity_on_hand <= i.min_stock',
    );
  });
});
