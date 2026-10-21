import type { CustomerReturnableDto } from '@pallet/shared';
import { describe, expect, it } from 'vitest';
import { allocate, itemHoldings, outBy, refundMaximum, type HeldLine } from './allocate';

const line = (orderNumber: number, orderDate: string, outQuantity: number, unitDeposit = 7_000): HeldLine => ({
  orderId: orderNumber,
  orderNumber,
  orderDate,
  orderLineId: orderNumber * 10,
  outQuantity,
  unitDeposit,
});
const placed = (shares: ReturnType<typeof allocate>) =>
  shares.map((share) => [share.orderNumber, share.accepted, share.damaged, share.damagedRefund]);

describe('returns of an item across orders, oldest first (Q160)', () => {
  it("the business's example: 26 and 26 out, 50 back — 26 from the older, 24 from the newer, 2 left there", () => {
    const shares = allocate([line(11, '2026-09-19', 26), line(13, '2026-10-18', 26)], {
      accepted: 50,
      damaged: 0,
      damagedRefund: 0,
    });

    expect(placed(shares)).toEqual([
      [11, 26, 0, 0],
      [13, 24, 0, 0],
    ]);
    expect(shares[1]!.outQuantity - shares[1]!.accepted).toBe(2);
  });

  it('places the damaged pallets first, oldest first, and their refund with them, each line capped by its deposit', () => {
    // 3 damaged and 10 accepted over 2 at 7,000 then 20 at 8,000; a refund of 10,000.
    const shares = allocate([line(11, '2026-09-01', 2, 7_000), line(13, '2026-09-05', 20, 8_000)], {
      accepted: 10,
      damaged: 3,
      damagedRefund: 10_000,
    });

    // The older line: both its pallets damaged, refund up to their 14,000 deposit takes all 10,000.
    expect(placed(shares)).toEqual([
      [11, 0, 2, 10_000],
      [13, 10, 1, 0],
    ]);
    expect(refundMaximum(shares)).toBe(2 * 7_000 + 1 * 8_000);
  });

  it('spills a refund past the older line onto the next one with damaged pallets', () => {
    const shares = allocate([line(11, '2026-09-01', 1, 5_000), line(13, '2026-09-05', 5, 5_000)], {
      accepted: 0,
      damaged: 3,
      damagedRefund: 8_000,
    });

    expect(placed(shares)).toEqual([
      [11, 0, 1, 5_000],
      [13, 0, 2, 3_000],
    ]);
  });

  it('leaves unplaced what is over the out total, for the form to refuse', () => {
    const shares = allocate([line(11, '2026-09-01', 4)], { accepted: 6, damaged: 0, damagedRefund: 0 });

    expect(placed(shares)).toEqual([[11, 4, 0, 0]]);
  });

  it('places nothing on an order dated after the return, and counts only what was out by that day', () => {
    const lines = [line(11, '2026-09-10', 26), line(13, '2026-09-20', 26)];

    const shares = allocate(lines, { accepted: 30, damaged: 0, damagedRefund: 0 }, '2026-09-15');

    expect(placed(shares)).toEqual([
      [11, 26, 0, 0],
      [13, 0, 0, 0],
    ]);
    expect(shares.map((share) => share.afterDate)).toEqual([false, true]);
    expect(outBy(lines, '2026-09-15')).toBe(26);
    expect(outBy(lines, null)).toBe(52);
  });

  it('works the same over twenty orders of one item: oldest first until the count runs out', () => {
    // 20 orders of 26 each, one a day from 1 September: 520 out; 300 back.
    const lines = Array.from({ length: 20 }, (_, index) =>
      line(100 + index, `2026-09-${String(index + 1).padStart(2, '0')}`, 26),
    );

    const shares = allocate(lines, { accepted: 300, damaged: 0, damagedRefund: 0 });

    // 11 orders fully back (286), the 12th gives 14 of its 26, the last 8 give nothing.
    expect(shares.map((share) => share.accepted)).toEqual([...Array(11).fill(26), 14, ...Array(8).fill(0)]);
    expect(shares.reduce((total, share) => total + share.accepted, 0)).toBe(300);
  });

  it('groups one item over orders and prices, oldest by date, then by number on one day', () => {
    const data = {
      customer: { id: 3, name: 'C', phone: '0750', archived: false },
      orders: [
        {
          id: 11,
          orderNumber: 11,
          date: '2026-10-01',
          paymentType: 'LENT',
          owed: 0,
          outQuantityTotal: 30,
          lines: [
            {
              id: 110,
              item: { id: 4, name: 'Euro', imageUrl: null, archived: false },
              outQuantity: 26,
              unitDeposit: 7_000,
            },
            {
              id: 111,
              item: { id: 6, name: 'Crate', imageUrl: null, archived: false },
              outQuantity: 4,
              unitDeposit: 9_000,
            },
          ],
        },
        // Entered later but dated earlier: it is the older one.
        {
          id: 13,
          orderNumber: 13,
          date: '2026-09-20',
          paymentType: 'LENT',
          owed: 0,
          outQuantityTotal: 26,
          lines: [
            {
              id: 130,
              item: { id: 4, name: 'Euro', imageUrl: null, archived: false },
              outQuantity: 26,
              unitDeposit: 8_000,
            },
          ],
        },
      ],
    } as unknown as CustomerReturnableDto;

    const holdings = itemHoldings(data);

    expect(
      holdings.map((holding) => [holding.item.name, holding.outQuantity, holding.lines.map((l) => l.orderLineId)]),
    ).toEqual([
      ['Euro', 52, [130, 110]],
      ['Crate', 4, [111]],
    ]);
  });
});
