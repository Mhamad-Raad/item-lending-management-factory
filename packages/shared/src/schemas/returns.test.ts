import { describe, expect, it } from 'vitest';
import { ReturnCreateBody } from './returns.js';

describe('ReturnCreateBody (§6.20, Q41)', () => {
  it('drops an entry that returns nothing, and keeps one that refunds damage', () => {
    const body = ReturnCreateBody.parse({
      date: '2026-09-11',
      lines: [
        { orderLineId: 1, acceptedQuantity: 0, damagedQuantity: 0 },
        { orderLineId: 2, acceptedQuantity: 5, damagedQuantity: 0 },
        { orderLineId: 3, acceptedQuantity: 0, damagedQuantity: 0, damagedRefund: 500 },
      ],
    });

    expect(body.lines.map((line) => line.orderLineId)).toEqual([2, 3]);
    expect(body.lines[0]?.damagedRefund).toBe(0);
    expect(body.notes).toBeUndefined();
  });

  it('leaves an all-zero return empty for the service to refuse, and rejects unknown keys and negatives', () => {
    expect(
      ReturnCreateBody.parse({
        date: '2026-09-11',
        lines: [{ orderLineId: 1, acceptedQuantity: 0, damagedQuantity: 0 }],
      }).lines,
    ).toEqual([]);
    expect(ReturnCreateBody.safeParse({ date: '2026-09-11', lines: [], extra: 1 }).success).toBe(false);
    expect(
      ReturnCreateBody.safeParse({
        date: '2026-09-11',
        lines: [{ orderLineId: 1, acceptedQuantity: -1, damagedQuantity: 0 }],
      }).success,
    ).toBe(false);
  });
});
