// @vitest-environment jsdom
import type { CustomerReturnReceiptDto, MoneyReceiptDto } from '@pallet/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { CustomerReturnReceipt, MoneyReceipt } from './money-receipt';

const PAYMENT: MoneyReceiptDto = {
  ledgerEntryId: 77,
  receiptNumberDisplay: '000077',
  kind: 'PAYMENT',
  date: '2026-09-11',
  printedOn: '2026-10-12',
  amount: 40_000,
  owedBefore: 100_000,
  credit: null,
  owedAfter: 60_000,
  source: 'MANUAL',
  note: null,
  recordedBy: { id: 1, username: 'admin', displayName: 'Admin' },
  reversedOn: null,
  order: {
    id: 9,
    orderNumber: 42,
    orderNumberDisplay: '000042',
    date: '2026-09-01',
  },
  factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
  customer: { name: 'Kurdistan Cement', phone: '07501234567', address: 'Erbil' },
  lines: [],
};

/** The money table's rows of the first half, label and figure, as the paper reads them. */
function rows(receipt: MoneyReceiptDto): string[] {
  const { container } = render(<MoneyReceipt receipt={receipt} />);
  const half = container.querySelector('.half');
  return [...(half?.querySelectorAll('.money tr') ?? [])].map((row) => row.textContent ?? '');
}

describe('money receipt (Q137)', () => {
  beforeAll(async () => {
    // The UI in English: the paper must still be Sorani.
    await i18n.changeLanguage('en');
  });
  afterEach(cleanup);

  it('prints a payment in Sorani: what was owed, what came in, what is left', () => {
    const { container } = render(<MoneyReceipt receipt={PAYMENT} />);
    expect(container.querySelector('.receipt')?.getAttribute('lang')).toBe('ckb');
    expect(container.querySelectorAll('.sheet')).toHaveLength(1);
    const halves = container.querySelectorAll('.half');
    expect(halves).toHaveLength(2);
    expect(halves[0]?.textContent).toBe(halves[1]?.textContent);
    expect(halves[0]?.textContent).toContain('پسووڵەی وەرگرتنی پارە');
    expect(halves[0]?.textContent).toContain('000077');
    cleanup();

    expect(rows(PAYMENT)).toEqual(['قەرز پێشتر100,000 دینار', 'بڕی وەرگیراو40,000 دینار', 'قەرز دواتر60,000 دینار']);
  });

  it('prints a refund with the credit of the pallets returned', () => {
    const refund: MoneyReceiptDto = {
      ...PAYMENT,
      kind: 'REFUND',
      source: 'RETURN_CREATE',
      amount: 15_000,
      owedBefore: 10_000,
      credit: 25_000,
      owedAfter: 0,
    };
    expect(rows(refund)).toEqual([
      'قەرز پێشتر10,000 دینار',
      'بەهای پالێتە گەڕاوەکان25,000 دینار',
      'بڕی دراوە بە کڕیار15,000 دینار',
      'قەرز دواتر0 دینار',
    ]);
  });

  it('prints the amount alone for an old payment whose balance could not be replayed', () => {
    expect(rows({ ...PAYMENT, owedBefore: null, owedAfter: null })).toEqual(['بڕی وەرگیراو40,000 دینار']);
  });

  it('names its number as a money receipt’s, apart from the order number beside it', () => {
    const { container } = render(<MoneyReceipt receipt={PAYMENT} />);
    const text = container.querySelector('.half')?.textContent ?? '';
    expect(text).toContain('ژمارەی پسووڵەی پارە: 000077');
    expect(text).toContain('ژمارەی داواکاری: 000042');
    expect(text).not.toContain('ژمارەی پسووڵە:');
  });

  it('carries the note, or says the automatic payment was taken at the hand-over', () => {
    expect(rows({ ...PAYMENT, note: 'Paid at the gate' }).at(-1)).toBe('تێبینیPaid at the gate');
    cleanup();
    expect(rows({ ...PAYMENT, source: 'ORDER_CREATE' }).at(-1)).toBe('تێبینیلە کاتی ڕادەستکردن، نەقد');
    cleanup();
    // Re-issued by a line edit: not taken at the hand-over, so no remark.
    expect(rows({ ...PAYMENT, source: 'ORDER_LINE_EDIT' })).toHaveLength(3);
  });

  it('stamps a reversed row with its day, and nothing else', () => {
    const standing = render(<MoneyReceipt receipt={PAYMENT} />);
    expect(standing.container.querySelector('.stamp')).toBeNull();
    cleanup();

    const { container } = render(<MoneyReceipt receipt={{ ...PAYMENT, reversedOn: '2026-10-01' }} />);
    const stamps = [...container.querySelectorAll('.stamp')].map((stamp) => stamp.textContent);
    expect(stamps).toEqual(['هەڵوەشێنراوەتەوە لە ⁨01/10/2026⁩', 'هەڵوەشێنراوەتەوە لە ⁨01/10/2026⁩']);
  });
});

const VISIT: CustomerReturnReceiptDto = {
  customerReturnId: 5,
  receiptNumberDisplay: '000005',
  date: '2026-10-20',
  printedOn: '2026-10-24',
  owedBefore: 60_000,
  credit: 72_500,
  amount: 42_500,
  owedAfter: 30_000,
  note: null,
  recordedBy: { id: 1, username: 'admin', displayName: 'Admin' },
  reversedOn: null,
  allReversed: false,
  factory: PAYMENT.factory,
  customer: PAYMENT.customer,
  lines: [],
};

describe('a customer return’s one receipt (Q161)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(cleanup);

  const half = (receipt: CustomerReturnReceiptDto) =>
    render(<CustomerReturnReceipt receipt={receipt} />).container.querySelector('.half');

  it('prints the refund’s figures summed, under a number of its own and without an order', () => {
    const paper = half(VISIT);
    expect([...(paper?.querySelectorAll('.money tr') ?? [])].map((row) => row.textContent)).toEqual([
      'قەرز پێشتر60,000 دینار',
      'بەهای پالێتە گەڕاوەکان72,500 دینار',
      'بڕی دراوە بە کڕیار42,500 دینار',
      'قەرز دواتر30,000 دینار',
    ]);
    const text = paper?.textContent ?? '';
    expect(text).toContain('پسووڵەی گەڕاندنەوەی پارە');
    expect(text).toContain('ژمارەی پسووڵەی گەڕاندنەوە: 000005');
    expect(text).not.toContain('ژمارەی پسووڵەی پارە');
    expect(text).not.toContain('ژمارەی داواکاری');
  });

  it('stamps it as partly cancelled, or as cancelled once all its returns are', () => {
    const partly = half({ ...VISIT, reversedOn: '2026-10-22' });
    expect(partly?.querySelector('.stamp')?.textContent).toBe('بەشێکی هەڵوەشێنراوەتەوە لە ⁨22/10/2026⁩');
    cleanup();
    const all = half({ ...VISIT, reversedOn: '2026-10-22', allReversed: true });
    expect(all?.querySelector('.stamp')?.textContent).toBe('هەڵوەشێنراوەتەوە لە ⁨22/10/2026⁩');
    cleanup();
    expect(half(VISIT)?.querySelector('.stamp')).toBeNull();
  });
});
