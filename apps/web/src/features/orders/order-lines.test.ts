import { describe, expect, it } from 'vitest';
import { depositTotalOf, toRequestLines, type LineRow } from './order-lines';

const deposits = new Map([
  [1, 1_000],
  [2, 2_500],
]);
const itemDeposit = (itemId: number): number | undefined => deposits.get(itemId);

describe('order lines', () => {
  it('matches the worked example of §7.4.1: A × 100 and B × 10 → 125,000', () => {
    const rows: LineRow[] = [
      { itemId: 1, quantity: 100, unitDeposit: null },
      { itemId: 2, quantity: 10, unitDeposit: null },
    ];

    expect(depositTotalOf(rows, itemDeposit)).toBe(125_000);
  });

  it('sends a unit deposit only when the user may set one and it differs from the default', () => {
    const rows: LineRow[] = [
      { itemId: 1, quantity: 100, unitDeposit: 1_000 },
      { itemId: 2, quantity: 10, unitDeposit: 2_000 },
    ];

    expect(toRequestLines(rows, itemDeposit, true)).toEqual([
      { itemId: 1, quantity: 100 },
      { itemId: 2, quantity: 10, unitDeposit: 2_000 },
    ]);
    expect(toRequestLines(rows, itemDeposit, false)).toEqual([
      { itemId: 1, quantity: 100 },
      { itemId: 2, quantity: 10 },
    ]);
  });

  it('counts only complete rows in the total, with a priced row at its own deposit', () => {
    const rows: LineRow[] = [
      { itemId: 1, quantity: 10, unitDeposit: 900 },
      { itemId: 2, quantity: null, unitDeposit: null },
      { itemId: null, quantity: 5, unitDeposit: null },
    ];

    expect(depositTotalOf(rows, itemDeposit)).toBe(9_000);
  });
});
