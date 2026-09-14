import type { LedgerEntryDto, OrderDetailDto, ReturnDto } from '@pallet/shared';
import { describe, expect, it } from 'vitest';
import { returnBaseline, returnSummary } from './return-math';

const ITEM = { id: 1, name: 'Pallet', imageUrl: null, archived: false };
const USER = { id: 1, username: 'admin', displayName: 'Admin' };

function order(
  paymentType: 'CASH' | 'LENT',
  ledger: (Pick<LedgerEntryDto, 'type' | 'amount'> & Partial<LedgerEntryDto>)[],
  returns: Partial<ReturnDto>[] = [],
): OrderDetailDto {
  return {
    id: 9,
    orderNumber: 1,
    date: '2026-09-11',
    paymentType,
    status: 'OPEN',
    cancelledAt: null,
    lines: [
      {
        id: 21,
        item: ITEM,
        quantity: 100,
        unitDeposit: 1_000,
        lineTotal: 100_000,
        returnedAccepted: 0,
        returnedDamaged: 0,
        outQuantity: 100,
      },
    ],
    returns: returns as ReturnDto[],
    ledgerEntries: ledger as LedgerEntryDto[],
  } as unknown as OrderDetailDto;
}

describe('return maths on the page (§7.4.2)', () => {
  it('reproduces the section example: LENT 100 × 1,000, 40,000 paid, 50 returned accepted', () => {
    const base = returnBaseline(order('LENT', [{ type: 'PAYMENT', amount: 40_000 }]));

    expect(
      returnSummary(base, [{ acceptedQuantity: 50, damagedQuantity: 0, damagedRefund: 0, unitDeposit: 1_000 }]),
    ).toEqual({
      refundDue: 50_000,
      owedBefore: 60_000,
      cashRefund: 0,
      owedAfter: 10_000,
      outAfter: 50,
      compensation: 0,
    });
  });

  it('U2: a replaced return is taken out, with its cash refund, before the new one is priced', () => {
    const replaced: Partial<ReturnDto> = {
      id: 5,
      reversed: false,
      cashRefund: 50_000,
      lines: [
        {
          id: 1,
          orderLineId: 21,
          item: ITEM,
          acceptedQuantity: 50,
          damagedQuantity: 0,
          unitDeposit: 1_000,
          damagedRefund: 0,
          compensation: 0,
        },
      ],
      createdBy: USER,
    };
    const cash = order(
      'CASH',
      [
        { type: 'PAYMENT', amount: 100_000 },
        { type: 'REFUND', amount: 50_000, returnId: 5, isReversed: false },
      ],
      [replaced],
    );

    expect(returnBaseline(cash)).toMatchObject({ owed: 0, outQuantityTotal: 50 });
    const base = returnBaseline(cash, 5);
    expect(base).toMatchObject({ owed: 0, outQuantityTotal: 100 });
    expect(
      returnSummary(base, [{ acceptedQuantity: 40, damagedQuantity: 0, damagedRefund: 0, unitDeposit: 1_000 }]),
    ).toMatchObject({
      refundDue: 40_000,
      cashRefund: 40_000,
      outAfter: 60,
    });
  });
});
