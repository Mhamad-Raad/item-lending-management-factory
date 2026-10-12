import type { MoneyReceiptDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** A payment of 40,000 on a credit order that owed 100,000 (§4.10 E5). */
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
};

/** A refund at the largest figures the inputs allow, with a note of the longest length: every row there can be. */
const REFUND: MoneyReceiptDto = {
  ...PAYMENT,
  kind: 'REFUND',
  source: 'RETURN_CREATE',
  amount: 999_999_000_000,
  owedBefore: 1_000_000_000_000,
  credit: 1_999_999_000_000,
  owedAfter: 0,
  note: 'ب'.repeat(500),
  reversedOn: '2026-10-01',
};

async function openReceipt(page: Page, receipt: MoneyReceiptDto | { status: number; json: unknown }) {
  await mockApi(page, ADMIN, 'en');
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.route(/\/api\/ledger-entries\/77\/receipt$/, (route) =>
    'status' in receipt ? route.fulfill(receipt) : route.fulfill({ json: receipt }),
  );
  await page.goto('/print/ledger/77');
}

const printed = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);

test('a payment receipt prints once, on one A4 sheet, in Sorani, with the balance it left', async ({ page }) => {
  await openReceipt(page, PAYMENT);

  await expect(page.locator('.sheet')).toHaveCount(1);
  await expect(page.locator('.half')).toHaveCount(2);
  await expect.poll(() => printed(page)).toBe(1);

  const half = page.locator('.half').first();
  await expect(page.locator('.receipt')).toHaveAttribute('dir', 'rtl');
  await expect(half).toContainText('پسووڵەی وەرگرتنی پارە');
  await expect(half).toContainText('000077');
  await expect(half).toContainText('000042');
  await expect(half.locator('.money tr')).toHaveText([
    'قەرز پێشتر100,000 دینار',
    'بڕی وەرگیراو40,000 دینار',
    'قەرز دواتر60,000 دینار',
  ]);
  await expect(half).toContainText('بەرواری چاپ: 12/10/2026');
  await expect(page.locator('.stamp')).toHaveCount(0);
  // Both copies say the same.
  expect(await page.locator('.half').nth(1).textContent()).toBe(await half.textContent());

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(1);
});

test('a reversed refund at the largest figures keeps every row inside its half, and the stamp off them', async ({
  page,
}) => {
  await openReceipt(page, REFUND);

  const half = page.locator('.half').first();
  await expect(half).toContainText('پسووڵەی گەڕاندنەوەی پارە');
  await expect(half.locator('.money tr')).toHaveCount(5);
  await expect(half.locator('.money tr').nth(1)).toHaveText('بەهای پالێتە گەڕاوەکان1,999,999,000,000 دینار');
  await expect(half.locator('.money tr').nth(2)).toHaveText('بڕی دراوە بە کڕیار999,999,000,000 دینار');
  await expect(half.locator('.stamp')).toHaveText('هەڵوەشێنراوەتەوە لە ⁨01/10/2026⁩');

  const layout = await half.evaluate((element) => {
    const box = (selector: string) => {
      const found = element.querySelector(selector);
      if (!found) throw new Error(`no ${selector}`);
      return found.getBoundingClientRect();
    };
    const [halfBox, money, stamp, footer] = [
      element.getBoundingClientRect(),
      box('.money'),
      box('.stamp'),
      // Both footer lines, the recorder and the print date.
      box('.footer-lines'),
    ];
    const apart = (a: DOMRect, b: DOMRect) =>
      a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    return {
      fits: element.scrollHeight <= element.clientHeight,
      stampInside: stamp.top >= halfBox.top && stamp.bottom <= halfBox.bottom,
      stampClearOfMoney: apart(stamp, money),
      stampClearOfFooterLines: apart(stamp, footer),
      cellsFit: [...element.querySelectorAll('.money td:not(.text)')].every(
        (cell) => cell.scrollWidth <= cell.clientWidth + 1,
      ),
    };
  });
  expect(layout).toEqual({
    fits: true,
    stampInside: true,
    stampClearOfMoney: true,
    stampClearOfFooterLines: true,
    cellsFit: true,
  });
});

test('a long Latin note keeps its beginning and loses its end', async ({ page }) => {
  await openReceipt(page, {
    ...PAYMENT,
    note: `START cheque 12345 ${'drawn on Kurdistan International Bank '.repeat(10)}END`,
  });

  const cell = page.locator('.half').first().locator('.money td.text');
  const shown = await cell.evaluate((td) => {
    const text = td.firstChild;
    if (!text) throw new Error('the note cell is empty');
    const at = (index: number) => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      return range.getBoundingClientRect();
    };
    const box = td.getBoundingClientRect();
    const inside = (rect: DOMRect) => rect.left >= box.left && rect.right <= box.right;
    const length = text.textContent?.length ?? 0;
    return { start: inside(at(0)), end: inside(at(length - 1)) };
  });
  expect(shown).toEqual({ start: true, end: false });
});

test('a reprint whose read fails prints nothing, says so, and keeps the paper', async ({ page }) => {
  await openReceipt(page, PAYMENT);
  await expect.poll(() => printed(page)).toBe(1);
  // The row went missing meanwhile: a considered answer, so no retries hold the test up.
  await page.route(/\/api\/ledger-entries\/77\/receipt$/, (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'LEDGER_ENTRY_NOT_FOUND', details: {} }, requestId: 'r' } }),
  );

  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
  expect(await printed(page)).toBe(1);
});

test('a reversal row has no receipt: the page says so in Sorani and prints nothing', async ({ page }) => {
  await openReceipt(page, {
    status: 409,
    json: { error: { code: 'LEDGER_ENTRY_NO_RECEIPT', details: { type: 'PAYMENT_REVERSAL' } }, requestId: 'r' },
  });

  await expect(page.getByText('ئەم تۆمارە پسووڵەی نییە')).toBeVisible();
  expect(await printed(page)).toBe(0);
});
