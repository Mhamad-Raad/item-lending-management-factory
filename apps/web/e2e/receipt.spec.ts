import type { ReceiptDto, ReceiptRowDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

type LineRow = Extract<ReceiptRowDto, { kind: 'line' }>;

/** A seven-line order, as the API lays it out: more than a half holds, so each copy has a page of its own (Q150). */
const lines: LineRow[] = Array.from({ length: 7 }, (_, index) => ({
  kind: 'line',
  no: index + 1,
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
  kind: 'line',
  no: 2,
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
  layout: 'pages',
  rowsPerCopy: 27,
  sheets: [{ sheetNumber: 1, sheetCount: 1, rows: lines, showTotal: true }],
  older: null,
};

/**
 * Two lines of the order and, under the heading, three of the customer's earlier orders still out: six rows, so
 * both copies share a sheet, and the footer carries the three totals — the largest the inputs allow (Q150).
 */
const WITH_OLDER: ReceiptDto = {
  ...RECEIPT,
  layout: 'halves',
  rowsPerCopy: 6,
  depositTotal: 20_000,
  sheets: [
    {
      sheetNumber: 1,
      sheetCount: 1,
      rows: [
        lines[0]!,
        { ...lines[2]!, no: 2 },
        { kind: 'olderHeading' },
        ...[41, 41, 57].map((order, index): ReceiptRowDto => ({
          kind: 'older',
          no: 3 + index,
          orderNumberDisplay: String(order).padStart(6, '0'),
          itemName: `Euro pallet ${index + 1}`,
          quantity: 20,
          unitDeposit: 5_000,
          returnedAccepted: 4,
          returnedDamaged: 1,
          outQuantity: 15,
          outValue: 75_000,
        })),
      ],
      showTotal: true,
    },
  ],
  older: { outValue: 1_000_000_000_000, combinedTotal: 1_000_000_020_000 },
};

async function openReceipt(page: Page, receipt: ReceiptDto | (() => ReceiptDto)) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      },
    }),
  );
  await page.route(/\/api\/orders\/9\/receipt$/, (route) =>
    route.fulfill({ json: typeof receipt === 'function' ? receipt() : receipt }),
  );
  await page.goto('/print/orders/9');
}

/**
 * Whether a copy's paper holds: every table row still 7 mm (a heading that wrapped, or a long figure, would make it
 * taller than the block budgets for), no cell but the item name wider than its column, and nothing of the blocks
 * or of the footer's lines past the copy's padding — the copy clips what overflows (§7.16.3).
 */
async function paperFit(page: Page, copy: string) {
  return page
    .locator(copy)
    .first()
    .evaluate((element) => {
      const table = element.querySelector('.lines');
      if (!table) throw new Error('the receipt has no lines table');
      const rowHeights = [...table.querySelectorAll('tr')].map((row) => row.getBoundingClientRect().height);
      const sevenMm = (7 * 96) / 25.4;
      const padding = (8 * 96) / 25.4;
      const bottom = element.getBoundingClientRect().bottom - padding + 0.5;
      const footer = element.querySelector('.block-footer');
      const footerBottom = (footer?.getBoundingClientRect().bottom ?? 0) + 0.5;
      return {
        rows: rowHeights.length,
        rowsKeepTheirHeight: rowHeights.every((height) => Math.abs(height - sevenMm) < 0.5),
        cellsFit: [...table.querySelectorAll('th, td:not(.col-item):not([colspan])')].every(
          (cell) => cell.scrollWidth <= cell.clientWidth + 1,
        ),
        blocksInside: [...element.children]
          .filter((block) => !block.classList.contains('cut-mark'))
          .every((block) => block.getBoundingClientRect().bottom <= bottom),
        footerInside: [...(footer?.children ?? [])].every((row) => row.getBoundingClientRect().bottom <= footerBottom),
      };
    });
}

async function pdfPages(page: Page): Promise<number> {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

test('E5: a seven-line receipt prints each copy on an A4 page of its own, in Sorani, and prints itself once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await openReceipt(page, RECEIPT);

  await expect(page.locator('.sheet')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  await expect(page.locator('.receipt')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.half')).toHaveCount(0);
  await expect(page.locator('.page')).toHaveCount(2);
  for (const sheet of await page.locator('.sheet').all()) {
    await expect(sheet).toContainText('پەڕەی 1 لە 1');
    await expect(sheet).toContainText('کۆی گشتی تەئمینات');
    await expect(sheet).toContainText('11/09/2026');
  }

  // Q134: what came back of each line, in three more columns that must not cost the copy any height.
  const firstCopy = page.locator('.page').first();
  await expect(firstCopy.locator('thead th')).toHaveText([
    '#',
    'جۆری پالێت',
    'بڕ',
    'وەرگیراو',
    'تێکچوو',
    'لای کڕیار',
    'تەئمیناتی دانە',
    'کۆ',
  ]);
  await expect(firstCopy.locator('tbody tr').first().locator('td')).toHaveText([
    '1',
    'Pallet 1',
    '10',
    '6',
    '1',
    '3',
    '1,000',
    '10,000',
  ]);
  await expect(firstCopy.locator('tbody tr').nth(1).locator('td')).toHaveText([
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
  await expect(firstCopy).toContainText('بەرواری چاپ: 15/09/2026');
  expect(await paperFit(page, '.page')).toEqual({
    rows: 28,
    rowsKeepTheirHeight: true,
    cellsFit: true,
    blocksInside: true,
    footerInside: true,
  });

  expect(await pdfPages(page)).toBe(2);
});

test("Q150: the customer's earlier pallets still out share the order's table, and both copies one sheet", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
    window.print = () => undefined;
  });
  await openReceipt(page, WITH_OLDER);

  await expect(page.locator('.sheet')).toHaveCount(1);
  await expect(page.locator('.half')).toHaveCount(2);
  const half = page.locator('.half').first();
  await expect(half.locator('tbody tr.older-heading')).toHaveText('پالێتی داواکارییە پێشووەکان کە هێشتا لای کڕیارن');
  await expect(half.locator('tbody tr.older')).toHaveCount(3);
  await expect(half.locator('tbody tr.older').first().locator('td')).toHaveText([
    '3',
    '000041 · Euro pallet 1',
    '20',
    '4',
    '1',
    '15',
    '5,000',
    '75,000',
  ]);
  // Shaded apart from the order's own lines, so a black-and-white print still tells them apart.
  const shade = (row: string) =>
    half
      .locator(row)
      .first()
      .locator('td')
      .first()
      .evaluate((cell) => getComputedStyle(cell).backgroundColor);
  expect(await shade('tbody tr:not(.older):not(.older-heading)')).not.toBe(await shade('tbody tr.older'));
  await expect(half.locator('.block-footer')).toContainText('کۆی تەئمیناتی ئەم داواکارییە: 20,000 دینار');
  await expect(half.locator('.block-footer')).toContainText(
    'کۆی گشتی لەگەڵ داواکارییە پێشووەکان: 1,000,000,020,000 دینار',
  );
  // Five footer rows, with the largest totals, in what the half has to spare.
  expect(await paperFit(page, '.half')).toEqual({
    rows: 7,
    rowsKeepTheirHeight: true,
    cellsFit: true,
    blocksInside: true,
    footerInside: true,
  });

  expect(await pdfPages(page)).toBe(1);
});

/**
 * Q134: the tab's Print button reads the order again, and what goes to the printer is that answer — the page as it
 * is at the moment `window.print()` is called, not a moment later.
 */
test('a reprint from a tab left open prints the figures of the order as it is now', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
    const prints: string[] = [];
    (window as unknown as { prints: string[] }).prints = prints;
    window.print = () => {
      prints.push(document.querySelector('.half tbody tr')?.textContent ?? '');
    };
  });
  const atHandOver: LineRow = { ...lines[0]!, returnedAccepted: 0, returnedDamaged: 0, outQuantity: 10 };
  let reads = 0;
  await openReceipt(page, () => {
    reads += 1;
    const first = reads === 1 ? atHandOver : lines[0]!;
    return {
      ...RECEIPT,
      layout: 'halves',
      rowsPerCopy: 6,
      sheets: [{ sheetNumber: 1, sheetCount: 1, rows: [first], showTotal: true }],
    };
  });
  const prints = (): Promise<string[]> => page.evaluate(() => (window as unknown as { prints: string[] }).prints);

  await expect.poll(prints).toEqual(['1Pallet 1100010' + '1,00010,000']);

  await page.getByRole('button', { name: 'Print' }).click();
  await expect.poll(prints).toHaveLength(2);
  expect((await prints())[1]).toBe('1Pallet 110613' + '1,00010,000');
});
