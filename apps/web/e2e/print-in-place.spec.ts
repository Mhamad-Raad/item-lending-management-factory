import type { MoneyReceiptDto, ReceiptDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';
import { catchFramePrints } from './receipt-frames';

const FACTORY = { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null };
const CUSTOMER = { name: 'Kurdistan Cement', phone: '07501234567', address: 'Erbil' };

/** The receipt of the mock order's payment, row 11. */
const MONEY: MoneyReceiptDto = {
  ledgerEntryId: 11,
  receiptNumberDisplay: '000011',
  kind: 'PAYMENT',
  date: '2026-09-11',
  printedOn: '2026-10-13',
  amount: 40_000,
  owedBefore: 100_000,
  credit: null,
  owedAfter: 60_000,
  source: 'MANUAL',
  note: null,
  recordedBy: { id: 1, username: 'admin', displayName: 'Admin' },
  reversedOn: null,
  order: { id: 9, orderNumber: ORDER.orderNumber, orderNumberDisplay: '123456', date: '2026-09-01' },
  factory: FACTORY,
  customer: CUSTOMER,
  lines: [],
};

const HANDOVER: ReceiptDto = {
  orderId: 9,
  orderNumber: ORDER.orderNumber,
  orderNumberDisplay: '123456',
  date: '2026-09-01',
  printedOn: '2026-10-13',
  paymentType: 'LENT',
  depositTotal: 100_000,
  factory: FACTORY,
  customer: { ...CUSTOMER, altPhone: null },
  driver: { name: 'Karwan', phone: '07701234567', carNumber: '22 Erbil 12345' },
  layout: 'halves',
  rowsPerCopy: 6,
  sheets: [{ sheetNumber: 1, sheetCount: 1, rows: [], showTotal: true }],
  older: null,
};

const NO_RECEIPT = {
  status: 409,
  json: { error: { code: 'LEDGER_ENTRY_NO_RECEIPT', details: { type: 'PAYMENT_REVERSAL' } }, requestId: 'r' },
};

async function openOrder(page: Page, money: { status: number; json: unknown; delayMs?: number }) {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: ORDER }));
  await page.route(/\/api\/orders\/9\/receipt$/, (route) => route.fulfill({ json: HANDOVER }));
  await page.route(/\/api\/ledger-entries\/11\/receipt$/, async (route) => {
    if (money.delayMs) await new Promise((resolve) => setTimeout(resolve, money.delayMs));
    await route.fulfill(money);
  });
  await page.goto('/orders/9');
}

test('Q140: a receipt prints in place — its own paper alone, no tab, the page stays — and again on the next press', async ({
  page,
  context,
}) => {
  const printed = await catchFramePrints(page);
  await openOrder(page, { status: 200, json: MONEY });

  await page.getByRole('button', { name: 'Print money receipt' }).click();

  await expect.poll(async () => (await printed()).length).toBe(1);
  const [paper] = await printed();
  // The receipt's Sorani paper, both copies, and nothing of the order page around it.
  expect(paper).toContain('پسووڵەی وەرگرتنی پارە');
  expect(paper?.match(/000011/g)).toHaveLength(2);
  expect(paper).not.toContain('Transactions');
  expect(context.pages()).toHaveLength(1);
  await expect(page).toHaveURL(/\/orders\/9$/);
  await expect(page.getByText('Preparing the receipt…')).toHaveCount(0);
  // The frame is never seen and never reached by Tab.
  const frame = page.locator('iframe[data-receipt-frame]');
  await expect(frame).toHaveAttribute('aria-hidden', 'true');
  await expect(frame).toHaveAttribute('tabindex', '-1');
  await expect(frame).toHaveCSS('opacity', '0');
  // Out of the page's own prints (a report printed later): it prints from its own window, never as part of the page.
  await page.emulateMedia({ media: 'print' });
  await expect(frame).toHaveCSS('display', 'none');
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Print money receipt' }).click();
  await expect.poll(async () => (await printed()).length).toBe(2);
  await expect(page.locator('iframe[data-receipt-frame]')).toHaveCount(1);
});

test('Q140: the hand-over receipt prints in place from the order page', async ({ page, context }) => {
  const printed = await catchFramePrints(page);
  await openOrder(page, { status: 200, json: MONEY });

  await page.getByRole('button', { name: 'Print receipt', exact: true }).click();

  await expect.poll(async () => (await printed()).length).toBe(1);
  expect((await printed())[0]).toContain('پسووڵەی ڕادەستکردنی پالێت');
  expect(context.pages()).toHaveLength(1);
});

test('Q140: a receipt that cannot be read says why on the page, and prints nothing', async ({ page }) => {
  const printed = await catchFramePrints(page);
  await openOrder(page, NO_RECEIPT);

  await page.getByRole('button', { name: 'Print money receipt' }).click();

  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'This entry has no receipt' })).toBeVisible();
  await expect(page.getByText('Preparing the receipt…')).toHaveCount(0);
  expect(await printed()).toEqual([]);
});

test('Q140: a second press while the first is being prepared replaces it: one print, not two', async ({ page }) => {
  const printed = await catchFramePrints(page);
  await openOrder(page, { status: 200, json: MONEY, delayMs: 700 });

  const print = page.getByRole('button', { name: 'Print money receipt' });
  await print.click();
  await print.click();

  await expect.poll(async () => (await printed()).length).toBe(1);
  await page.waitForTimeout(1_500);
  expect(await printed()).toHaveLength(1);
});

test('Q140: a server that cannot answer is said at once — one read, no retries, nothing printed later', async ({
  page,
}) => {
  const printed = await catchFramePrints(page);
  let reads = 0;
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: ORDER }));
  await page.route(/\/api\/ledger-entries\/11\/receipt$/, (route) => {
    reads += 1;
    return route.fulfill({ status: 503, body: 'down' });
  });
  await page.goto('/orders/9');

  await page.getByRole('button', { name: 'Print money receipt' }).click();

  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'The service is unavailable' })).toBeVisible({
    timeout: 1_500,
  });
  await page.waitForTimeout(3_000);
  expect(reads).toBe(1);
  expect(await printed()).toEqual([]);
});

test('Q140: a logo that never arrives does not hold the print for ever', async ({ page }) => {
  await page.clock.install();
  const printed = await catchFramePrints(page);
  await openOrder(page, { status: 200, json: { ...MONEY, factory: { ...FACTORY, logoUrl: '/uploads/logo.png' } } });
  // The logo's request is never answered.
  await page.route(/\/uploads\/logo\.png$/, () => new Promise<void>(() => undefined));

  await page.getByRole('button', { name: 'Print money receipt' }).click();
  await expect(page.locator('iframe[data-receipt-frame]')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await printed()).toEqual([]);

  await page.clock.fastForward(10_000);
  await expect.poll(async () => (await printed()).length).toBe(1);
});
