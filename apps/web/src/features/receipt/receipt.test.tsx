// @vitest-environment jsdom
import { layoutReceiptRows, type ReceiptDto, type ReceiptOlderLineDto, type ReceiptRowDto } from '@pallet/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { Receipt } from './receipt';

/**
 * A receipt as the API builds it (§6.19): the server lays the rows out, the page renders what it is given. `older`
 * are what the customer still holds of earlier orders, a row per item and price (Q150, Q158).
 */
function receiptWith(
  lineCount: number,
  returned = { returnedAccepted: 0, returnedDamaged: 0, outQuantity: 10 },
  older: Omit<ReceiptOlderLineDto, 'outValue'>[] = [],
): ReceiptDto {
  const rows: ReceiptRowDto[] = Array.from({ length: lineCount }, (_, index) => ({
    kind: 'line',
    no: index + 1,
    itemName: `Pallet ${index + 1}`,
    quantity: 10,
    unitDeposit: 1_000,
    lineTotal: 10_000,
    ...returned,
  }));
  const olderOut = older.map((line) => ({ ...line, outValue: line.outQuantity * line.unitDeposit }));
  if (olderOut.length > 0) rows.push({ kind: 'olderHeading' });
  olderOut.forEach((line, index) => rows.push({ kind: 'older', no: lineCount + index + 1, ...line }));
  const { layout, rowsPerCopy, chunks } = layoutReceiptRows(rows, (row) => row.kind === 'olderHeading');
  const depositTotal = lineCount * 10_000;
  const outValue = olderOut.reduce((sum, line) => sum + line.outValue, 0);
  return {
    orderId: 7,
    orderNumber: 123,
    orderNumberDisplay: '000123',
    date: '2026-09-11',
    printedOn: '2026-09-15',
    paymentType: 'LENT',
    depositTotal,
    factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
    customer: { name: 'Kurdistan Cement', phone: '07501234567', altPhone: null, address: 'Erbil, 100 m road' },
    driver: { name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' },
    layout,
    rowsPerCopy,
    sheets: chunks.map((chunk, index) => ({
      sheetNumber: index + 1,
      sheetCount: chunks.length,
      rows: chunk,
      showTotal: index === chunks.length - 1,
    })),
    older: olderOut.length > 0 ? { outValue, combinedTotal: depositTotal + outValue } : null,
  };
}

/** What the customer still holds of an item over their earlier orders: 15 at 5,000 each (Q158). */
const EARLIER = { itemName: 'Euro pallet', unitDeposit: 5_000, outQuantity: 15 };

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

  it('fits six lines on one sheet of two halves; from seven, each copy has a page of its own (Q150)', () => {
    const six = render(<Receipt receipt={receiptWith(6)} />).container;
    expect(six.querySelectorAll('.sheet')).toHaveLength(1);
    expect(six.querySelectorAll('.half')).toHaveLength(2);
    cleanup();

    const { container } = render(<Receipt receipt={receiptWith(7)} />);
    const sheets = [...container.querySelectorAll('.sheet')];
    expect(sheets).toHaveLength(2);
    expect(container.querySelectorAll('.half')).toHaveLength(0);
    expect(sheets.map((sheet) => sheet.querySelectorAll('.page').length)).toEqual([1, 1]);
    // The factory's copy and the customer's, the same paper, each with the total and 27 rows of grid.
    expect(sheets[0]?.textContent).toBe(sheets[1]?.textContent);
    expect(sheets[0]?.textContent).toContain(TOTAL_LABEL);
    expect(sheets[0]?.textContent).toContain('Pallet 7');
    expect(sheets[0]?.querySelectorAll('tbody tr')).toHaveLength(27);
    expect(container.querySelector('.cut-mark')).toBeNull();
  });

  it("prints thirty lines on two pages per copy, the factory's pages first, the total on the last of each", () => {
    const { container } = render(<Receipt receipt={receiptWith(30)} />);

    // The factory's pages 1 and 2, then the customer's 1 and 2: each copy comes off the printer in one stack.
    const sheets = [...container.querySelectorAll('.sheet')];
    expect(sheets).toHaveLength(4);
    expect(sheets[0]?.textContent).not.toContain(TOTAL_LABEL);
    expect(sheets[0]?.textContent).toContain('پەڕەی 1 لە 2');
    expect(sheets[1]?.textContent).toContain(TOTAL_LABEL);
    expect(sheets[1]?.textContent).toContain('پەڕەی 2 لە 2');
    expect(sheets[2]?.textContent).toBe(sheets[0]?.textContent);
    expect(sheets[3]?.textContent).toBe(sheets[1]?.textContent);
    const firstCells = [...(sheets[1]?.querySelectorAll('tbody tr td:first-child') ?? [])];
    expect(firstCells.slice(0, 4).map((cell) => cell.textContent)).toEqual(['28', '29', '30', '']);
  });

  it("lists the customer's earlier pallets still out under the order's, shaded, with the three totals (Q150)", () => {
    const { container } = render(<Receipt receipt={receiptWith(2, undefined, [EARLIER])} />);

    // Two lines, the heading and one earlier line still fit a half.
    expect(container.querySelectorAll('.half')).toHaveLength(2);
    const half = container.querySelector('.half');
    const body = [...(half?.querySelectorAll('tbody tr') ?? [])];
    expect(body.map((row) => row.className)).toEqual(['', '', 'older-heading', 'older', '', '']);
    expect(body[2]?.textContent).toBe('پالێتی داواکارییە پێشووەکان کە هێشتا لای کڕیارن');
    // Only what is still out (Q158): the item over the quantity, accepted and damaged columns, then the 15 still out,
    // its deposit, and in the total column the deposit of those 15.
    const cells = [...(body[3]?.querySelectorAll('td') ?? [])];
    expect(cells.map((cell) => cell.textContent)).toEqual(['3', 'Euro pallet', '15', '5,000', '75,000']);
    expect(cells.map((cell) => cell.colSpan)).toEqual([1, 4, 1, 1, 1]);
    const footer = half?.querySelector('.block-footer');
    expect(footer?.classList.contains('with-older')).toBe(true);
    expect(footer?.textContent).toContain('کۆی تەئمیناتی ئەم داواکارییە: 20,000 دینار');
    expect(footer?.textContent).toContain('تەئمیناتی پالێتە پێشووەکانی لای کڕیار: 75,000 دینار');
    expect(footer?.textContent).toContain('کۆی گشتی: 95,000 دینار');
    expect(footer?.textContent).not.toContain(TOTAL_LABEL);
  });

  it('turns to a page per copy when the earlier pallets make the table outgrow a half (Q150)', () => {
    const { container } = render(<Receipt receipt={receiptWith(4, undefined, [EARLIER, EARLIER])} />);

    expect(container.querySelectorAll('.half')).toHaveLength(0);
    expect(container.querySelectorAll('.page')).toHaveLength(2);
    const firstCells = [...(container.querySelector('.page')?.querySelectorAll('tbody tr td:first-child') ?? [])];
    expect(firstCells.slice(0, 8).map((cell) => cell.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      'پالێتی داواکارییە پێشووەکان کە هێشتا لای کڕیارن',
      '5',
      '6',
      '',
    ]);
  });

  it('says per line what came back accepted, what came back damaged and what is still out (Q134)', () => {
    const { container } = render(
      <Receipt receipt={receiptWith(2, { returnedAccepted: 6, returnedDamaged: 1, outQuantity: 3 })} />,
    );

    const half = container.querySelector('.half');
    const headers = [...(half?.querySelectorAll('thead th') ?? [])].map((cell) => cell.textContent);
    // Beside the quantity they add up to, and before the money columns.
    expect(headers.slice(2, 6)).toEqual(['بڕ', 'وەرگیراو', 'تێکچوو', 'لای کڕیار']);
    const rows = [...(half?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.querySelectorAll('td')].slice(2, 6).map((cell) => cell.textContent),
    );
    expect(rows.slice(0, 3)).toEqual([
      ['10', '6', '1', '3'],
      ['10', '6', '1', '3'],
      // A row without a line stays empty: no zeros in the blank part of the grid.
      ['', '', '', ''],
    ]);
    // The figures are true as of the day of printing, which is not the hand-over's date.
    expect(half?.textContent).toContain('بەرواری چاپ: 15/09/2026');
  });

  it('sets a figure too long for its column smaller instead of letting it run into the next', () => {
    const receipt = receiptWith(1);
    const line = receipt.sheets[0]?.rows[0];
    if (line?.kind !== 'line') throw new Error('the receipt has a line');
    Object.assign(line, { quantity: 1_000_000, outQuantity: 999_999, lineTotal: 1_000_000_000_000 });
    const { container } = render(<Receipt receipt={receipt} />);

    const cells = [...(container.querySelector('.half tbody tr')?.querySelectorAll('td') ?? [])];
    expect(cells.map((cell) => [cell.textContent, cell.classList.contains('num-tight')]).slice(2)).toEqual([
      ['1,000,000', true],
      ['0', false],
      ['0', false],
      ['999,999', false],
      ['1,000', false],
      ['1,000,000,000,000', true],
    ]);
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
