import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translateSummaryParams } from './audit-summary';

const t = ((key: string) => `t(${key})`) as unknown as TFunction;

describe('audit summary params', () => {
  it('translates enum values', () => {
    expect(translateSummaryParams(t, { paymentType: 'CASH', role: 'ADMIN' })).toEqual({
      paymentType: 't(enums.paymentType.CASH)',
      role: 't(enums.role.ADMIN)',
    });
  });

  it('shows order numbers six digits wide and amounts and counts with separators (A6, §7.10)', () => {
    expect(
      translateSummaryParams(t, {
        orderNumber: 1,
        depositTotal: 100_000,
        amount: 40_000,
        excess: 10_000,
        depositPrice: 5_000,
        quantity: -1_250,
        initialQuantity: 1_000,
        name: 'Euro pallet',
      }),
    ).toEqual({
      orderNumber: '000001',
      depositTotal: '100,000',
      amount: '40,000',
      excess: '10,000',
      depositPrice: '5,000',
      quantity: '-1,250',
      initialQuantity: '1,000',
      name: 'Euro pallet',
    });
  });

  it('formats a return: its counts, its credit and its cash refund (§11.3)', () => {
    expect(
      translateSummaryParams(t, { orderNumber: 42, accepted: 1_500, damaged: 10, refundDue: 1_504_000, cashRefund: 0 }),
    ).toEqual({ orderNumber: '000042', accepted: '1,500', damaged: '10', refundDue: '1,504,000', cashRefund: '0' });
  });
});
