// @vitest-environment jsdom
import { RECEIPT_LINES_PER_HALF, chunkReceiptLines, type ReceiptDto } from '@pallet/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { Receipt } from './receipt';

/** A receipt as the API builds it (§6.19): the server chunks, the page renders what it is given. */
function receiptWith(lineCount: number): ReceiptDto {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    itemName: `Pallet ${index + 1}`,
    quantity: 10,
    unitDeposit: 1_000,
    lineTotal: 10_000,
  }));
  const chunks = chunkReceiptLines(lines);
  return {
    orderId: 7,
    orderNumber: 123,
    orderNumberDisplay: '000123',
    date: '2026-09-11',
    paymentType: 'LENT',
    depositTotal: lineCount * 10_000,
    factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
    customer: { name: 'Kurdistan Cement', phone: '07501234567', altPhone: null, address: 'Erbil, 100 m road' },
    driver: { name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' },
    linesPerHalf: RECEIPT_LINES_PER_HALF,
    sheets: chunks.map((chunk, index) => ({
      sheetNumber: index + 1,
      sheetCount: chunks.length,
      lines: chunk,
      showTotal: index === chunks.length - 1,
    })),
  };
}

const TOTAL_LABEL = 'کۆی گشتی تەئمینات';

describe('receipt (§7.16.5)', () => {
  beforeAll(async () => {
    // The UI language does not matter: the receipt stays Sorani.
    await i18n.changeLanguage('en');
  });
  afterEach(cleanup);

  it('prints one line on one sheet of two halves, with the total', () => {
    const { container } = render(<Receipt receipt={receiptWith(1)} />);

    expect(container.querySelectorAll('.sheet')).toHaveLength(1);
    expect(container.querySelectorAll('.half')).toHaveLength(2);
    expect(container.textContent).toContain(TOTAL_LABEL);
  });

  it('fits six lines on one sheet, and seven on two with the total only on the second', () => {
    expect(render(<Receipt receipt={receiptWith(6)} />).container.querySelectorAll('.sheet')).toHaveLength(1);
    cleanup();

    const { container } = render(<Receipt receipt={receiptWith(7)} />);
    const sheets = [...container.querySelectorAll('.sheet')];
    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.textContent).not.toContain(TOTAL_LABEL);
    expect(sheets[0]?.textContent).toContain('Pallet 6');
    expect(sheets[1]?.textContent).toContain(TOTAL_LABEL);
    expect(sheets[1]?.textContent).toContain('Pallet 7');
    expect(sheets[1]?.textContent).toContain('پەڕەی 2 لە 2');
  });

  it('prints fourteen lines on three sheets, numbering lines across them', () => {
    const { container } = render(<Receipt receipt={receiptWith(14)} />);

    const sheets = [...container.querySelectorAll('.sheet')];
    expect(sheets).toHaveLength(3);
    const firstCells = [...(sheets[2]?.querySelector('.half tbody')?.querySelectorAll('tr td:first-child') ?? [])];
    expect(firstCells.map((cell) => cell.textContent)).toEqual(['13', '14', '', '', '', '']);
  });

  it('prints both halves of a sheet identically, in Sorani and right to left', () => {
    const { container } = render(<Receipt receipt={receiptWith(3)} />);

    const [top, bottom] = [...container.querySelectorAll('.half')];
    expect(top?.textContent).toBe(bottom?.textContent);
    const root = container.querySelector('.receipt');
    expect(root?.getAttribute('dir')).toBe('rtl');
    expect(root?.getAttribute('lang')).toBe('ckb');
    expect(container.textContent).toContain('پسووڵەی ڕادەستکردنی پالێت');
    expect(container.textContent).toContain('000123');
    expect(container.textContent).toContain('11/09/2026');
  });
});
