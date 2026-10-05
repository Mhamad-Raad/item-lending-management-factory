import type { ReceiptDto, ReceiptLineDto } from '@pallet/shared';
import { expect, test } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** A seven-line order, as the API chunks it: six lines on sheet 1, one on sheet 2 with the total. */
const lines: ReceiptLineDto[] = Array.from({ length: 7 }, (_, index) => ({
  itemName: `Pallet ${index + 1}`,
  quantity: 10,
  unitDeposit: 1_000,
  lineTotal: 10_000,
  returnedAccepted: 6,
  returnedDamaged: 1,
  outQuantity: 3,
}));
/** The second line carries the largest figures the inputs allow: they must still stay inside their columns. */
lines[1] = {
  itemName: 'Pallet 2',
  quantity: 1_000_000,
  unitDeposit: 1_000_000,
  lineTotal: 1_000_000_000_000,
  returnedAccepted: 100_000,
  returnedDamaged: 100_000,
  outQuantity: 800_000,
};
const RECEIPT: ReceiptDto = {
  orderId: 9,
  orderNumber: 42,
  orderNumberDisplay: '000042',
  date: '2026-09-11',
  printedOn: '2026-09-15',
  paymentType: 'LENT',
  depositTotal: 70_000,
  factory: { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null },
  customer: { name: 'Kurdistan Cement', phone: '07501234567', altPhone: null, address: 'Erbil' },
  driver: { name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' },
  linesPerHalf: 6,
  sheets: [
    { sheetNumber: 1, sheetCount: 2, lines: lines.slice(0, 6), showTotal: false },
    { sheetNumber: 2, sheetCount: 2, lines: lines.slice(6), showTotal: true },
  ],
};

test('E5: a seven-line receipt prints on exactly two A4 sheets, in Sorani, and prints itself once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      },
    }),
  );
  await page.route(/\/api\/orders\/9\/receipt$/, (route) => route.fulfill({ json: RECEIPT }));

  await page.goto('/print/orders/9');
  await expect(page.locator('.sheet')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  const receipt = page.locator('.receipt');
  await expect(receipt).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.sheet').first()).toContainText('پەڕەی 1 لە 2');
  await expect(page.locator('.sheet').first()).not.toContainText('کۆی گشتی تەئمینات');
  await expect(page.locator('.sheet').last()).toContainText('کۆی گشتی تەئمینات');
  await expect(page.locator('.sheet').first()).toContainText('11/09/2026');
  await expect(page.locator('.half')).toHaveCount(4);

  // Q134: what came back of each line, in three more columns that must not cost the half any height — a heading
  // that wrapped would make its row taller than the 7 mm the block budgets for, and the half clips what overflows.
  const firstHalf = page.locator('.half').first();
  await expect(firstHalf.locator('thead th')).toHaveText([
    '#',
    'جۆری پالێت',
    'بڕ',
    'وەرگیراو',
    'تێکچوو',
    'لای کڕیار',
    'تەئمیناتی دانە',
    'کۆ',
  ]);
  await expect(firstHalf.locator('tbody tr').first().locator('td')).toHaveText([
    '1',
    'Pallet 1',
    '10',
    '6',
    '1',
    '3',
    '1,000',
    '10,000',
  ]);
  await expect(firstHalf.locator('tbody tr').nth(1).locator('td')).toHaveText([
    '2',
    'Pallet 2',
    '1,000,000',
    '100,000',
    '100,000',
    '800,000',
    '1,000,000',
    '1,000,000,000,000',
  ]);
  // The day the figures were read, apart from the hand-over's date in the header.
  await expect(firstHalf).toContainText('بەرواری چاپ: 15/09/2026');
  const fit = await firstHalf.evaluate((half) => {
    const table = half.querySelector('.lines');
    if (!table) throw new Error('the receipt has no lines table');
    const rowHeights = [...table.querySelectorAll('tr')].map((row) => row.getBoundingClientRect().height);
    const sevenMm = (7 * 96) / 25.4;
    return {
      rows: rowHeights.length,
      rowsKeepTheirHeight: rowHeights.every((height) => Math.abs(height - sevenMm) < 0.5),
      cellsFit: [...table.querySelectorAll('th, td:not(.col-item)')].every(
        (cell) => cell.scrollWidth <= cell.clientWidth + 1,
      ),
    };
  });
  expect(fit).toEqual({ rows: 7, rowsKeepTheirHeight: true, cellsFit: true });

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages).toHaveLength(2);
});
