import type { TransactionsReceiptDto, TransactionsReceiptRowDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** Seven rows at the largest figure the inputs allow, the second of them reversed: two sheets, every cell full. */
const ROWS: TransactionsReceiptRowDto[] = Array.from({ length: 7 }, (_, index) => ({
  ledgerEntryId: 70 + index,
  receiptNumberDisplay: `0000${70 + index}`,
  kind: index === 6 ? 'REFUND' : 'PAYMENT',
  date: `2026-09-0${index + 2}`,
  amount: 999_999_000_000,
  reversedOn: index === 1 ? '2026-10-01' : null,
}));

const RECEIPT: TransactionsReceiptDto = {
  order: { id: 9, orderNumber: 42, orderNumberDisplay: '000042', date: '2026-09-01' },
  printedOn: '2026-10-13',
  factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
  customer: { name: 'Kurdistan Cement', phone: '07501234567', address: 'Erbil' },
  received: 4_999_995_000_000,
  refunded: 999_999_000_000,
  owed: 999_999_000_000,
  rowsPerHalf: 6,
  sheets: [
    { sheetNumber: 1, sheetCount: 2, rows: ROWS.slice(0, 6), showTotal: false },
    { sheetNumber: 2, sheetCount: 2, rows: ROWS.slice(6), showTotal: true },
  ],
};

async function openReceipt(page: Page, receipt: TransactionsReceiptDto) {
  await mockApi(page, ADMIN, 'en');
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.route(/\/api\/orders\/9\/transactions-receipt$/, (route) => route.fulfill({ json: receipt }));
  await page.goto('/print/transactions/9');
}

const printed = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);

test('Q139: every payment and refund of an order, six to a half, totals on the last sheet, printed once', async ({
  page,
}) => {
  await openReceipt(page, RECEIPT);

  await expect(page.locator('.sheet')).toHaveCount(2);
  await expect(page.locator('.half')).toHaveCount(4);
  await expect.poll(() => printed(page)).toBe(1);
  await expect(page.locator('.receipt')).toHaveAttribute('dir', 'rtl');

  const first = page.locator('.half').first();
  await expect(first).toContainText('پسووڵەی مامەڵەکانی پارە');
  await expect(first).toContainText('000042');
  await expect(first.locator('thead th')).toHaveText(['#', 'بەروار', 'ژمارەی پسووڵە', 'جۆر', 'بڕ', 'دۆخ']);
  await expect(first.locator('tbody tr').first().locator('td')).toHaveText([
    '1',
    '02/09/2026',
    '000070',
    'پارەدان',
    '999,999,000,000',
    '',
  ]);
  // The reversed row is listed, struck through, and says since when.
  const reversed = first.locator('tbody tr').nth(1);
  await expect(reversed).toHaveClass('reversed');
  await expect(reversed.locator('td.status')).toHaveText('هەڵوەشێنراوەتەوە لە ⁨01/10/2026⁩');
  await expect(reversed.locator('td.amount')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(first).toContainText('بەردەوامە لە پەڕەی داهاتوو');
  await expect(first).not.toContainText('کۆی وەرگیراو');

  const last = page.locator('.half').nth(2);
  await expect(last.locator('tbody tr').first()).toContainText('7');
  await expect(last.locator('tbody tr').first()).toContainText('گەڕاندنەوەی پارە');
  await expect(last).toContainText('کۆی وەرگیراو: 4,999,995,000,000 دینار');
  await expect(last).toContainText('کۆی گەڕێنراوە: 999,999,000,000 دینار');
  await expect(last).toContainText('قەرزی ئێستا: 999,999,000,000 دینار');
  await expect(last).toContainText('پەڕەی 2 لە 2');

  // Nothing runs out of its half or its cell at the largest figures.
  for (const half of await page.locator('.half').all()) {
    const fits = await half.evaluate((element) => ({
      half: element.scrollHeight <= element.clientHeight,
      cells: [...element.querySelectorAll('.lines td.num')].every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
      footer: [...element.querySelectorAll('.block-footer > *')].every(
        (line) => line.scrollWidth <= line.clientWidth + 1,
      ),
    }));
    expect(fits).toEqual({ half: true, cells: true, footer: true });
  }

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(2);
});
