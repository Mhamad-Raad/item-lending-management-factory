import type { OrderLineInput } from '@pallet/shared';

/** One row of the lines editor, as the form holds it: empty boxes are null. */
export interface LineRow {
  itemId: number | null;
  quantity: number | null;
  /** Null while the row follows its default deposit; a number only once a user who may price types one. */
  unitDeposit: number | null;
}

export const EMPTY_LINE: LineRow = { itemId: null, quantity: null, unitDeposit: null };

/**
 * The lines to send (§7.4.1, Q15). A row carries `unitDeposit` only when the user may set deposits and
 * set one that differs from the row's default — the item's deposit for a new line, the stored one for a
 * line already on the order — so the server applies the same default and nothing is overridden by
 * accident. Rows without an item or a quantity are left to the form's validation.
 */
export function toRequestLines(
  rows: readonly LineRow[],
  defaultDeposit: (itemId: number) => number | undefined,
  canPrice: boolean,
): { itemId: number | null; quantity: number | null; unitDeposit?: number }[] {
  return rows.map((row) => {
    const base = { itemId: row.itemId, quantity: row.quantity };
    if (!canPrice || row.itemId === null || row.unitDeposit === null) return base;
    const fallback = defaultDeposit(row.itemId);
    return fallback === undefined || row.unitDeposit === fallback ? base : { ...base, unitDeposit: row.unitDeposit };
  });
}

/** Σ quantity × unit deposit over the rows that are complete enough to have a total. */
export function depositTotalOf(
  rows: readonly LineRow[],
  defaultDeposit: (itemId: number) => number | undefined,
): number {
  return rows.reduce((total, row) => {
    if (row.itemId === null || row.quantity === null) return total;
    const unitDeposit = row.unitDeposit ?? defaultDeposit(row.itemId);
    return unitDeposit === undefined ? total : total + row.quantity * unitDeposit;
  }, 0);
}

/** The request lines once every row is complete; the schema has checked that before a submit. */
export function asOrderLines(lines: ReturnType<typeof toRequestLines>): OrderLineInput[] {
  return lines.map((line) => ({
    itemId: line.itemId ?? 0,
    quantity: line.quantity ?? 0,
    ...(line.unitDeposit === undefined ? {} : { unitDeposit: line.unitDeposit }),
  }));
}
