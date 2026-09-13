import type {
  ActivityReportDto,
  LedgerEntryDto,
  MeDto,
  PositionsReportDto,
  PurchasesReportDto,
  StockReportDto,
} from '@pallet/shared';
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';

const AT = '2026-09-12T09:00:00.000Z';
const A = { id: 5, name: 'Pallet A', imageUrl: null, archived: false };
const B = { id: 6, name: 'Pallet B', imageUrl: null, archived: false };
const ASHTI = { id: 3, name: 'Ashti Blocks', phone: '07501111111', archived: false };
const BABAN = { id: 4, name: 'Baban Cement', phone: '07502222222', archived: false };

const POSITIONS: PositionsReportDto = {
  generatedAt: AT,
  columns: [A, B],
  rows: [
    {
      customer: ASHTI,
      palletsOutByItem: [
        { itemId: 5, quantityOut: 50 },
        { itemId: 6, quantityOut: 0 },
      ],
      palletsOut: 50,
      outValue: 50_000,
      owed: 10_000,
      held: 40_000,
    },
    {
      customer: BABAN,
      palletsOutByItem: [
        { itemId: 5, quantityOut: 25 },
        { itemId: 6, quantityOut: 8 },
      ],
      palletsOut: 33,
      outValue: 45_000,
      owed: 10_000,
      held: 35_000,
    },
  ],
  totals: {
    palletsOutByItem: [
      { itemId: 5, quantityOut: 75 },
      { itemId: 6, quantityOut: 8 },
    ],
    palletsOut: 83,
    outValue: 95_000,
    owed: 20_000,
    held: 75_000,
  },
};

const PURCHASES: PurchasesReportDto = {
  generatedAt: AT,
  dateFrom: '2026-09-01',
  dateTo: '2026-09-12',
  rows: [
    { batchId: 1, item: A, date: '2026-09-01', quantity: 500, unitCost: 700, totalCost: 350_000, note: null },
    { batchId: 2, item: B, date: '2026-09-01', quantity: 100, unitCost: 700, totalCost: 70_000, note: null },
    { batchId: 3, item: A, date: '2026-09-03', quantity: 50, unitCost: 800, totalCost: 40_000, note: 'Second truck' },
  ],
  perItem: [
    { item: A, batchCount: 2, quantity: 550, totalCost: 390_000 },
    { item: B, batchCount: 1, quantity: 100, totalCost: 70_000 },
  ],
  totals: { batchCount: 3, quantity: 650, totalCost: 460_000 },
  truncated: false,
};

const entry = (overrides: Partial<LedgerEntryDto>): LedgerEntryDto => ({
  ...(ORDER.ledgerEntries[0] as LedgerEntryDto),
  ...overrides,
});
const ACTIVITY: ActivityReportDto = {
  generatedAt: AT,
  dateFrom: '2026-09-01',
  dateTo: '2026-09-12',
  filters: { customerId: null, itemId: null, driverId: null },
  moneyOmitted: false,
  handovers: [
    {
      orderId: 9,
      orderNumber: 1,
      date: '2026-09-01',
      customer: ASHTI,
      driver: ORDER.driver,
      paymentType: 'LENT',
      lines: [{ item: A, quantity: 100, unitDeposit: 1_000, lineTotal: 100_000 }],
      quantity: 100,
      depositTotal: 100_000,
    },
  ],
  returns: [
    {
      returnId: 5,
      orderId: 9,
      orderNumber: 1,
      date: '2026-09-05',
      customer: ASHTI,
      lines: [{ item: A, acceptedQuantity: 50, damagedQuantity: 0, damagedRefund: 0, compensation: 0 }],
      acceptedQuantity: 50,
      damagedQuantity: 0,
      refundDue: 50_000,
      cashRefund: 0,
    },
  ],
  payments: [
    entry({ id: 11, orderNumber: 1, type: 'PAYMENT', source: 'MANUAL', amount: 40_000, effectiveDate: '2026-09-03' }),
    entry({
      id: 12,
      orderNumber: 1,
      type: 'PAYMENT_REVERSAL',
      source: 'PAYMENT_DELETE',
      amount: 5_000,
      effectiveDate: '2026-09-12',
      reversesEntryId: 11,
    }),
  ],
  refunds: [],
  compensation: [],
  totals: {
    handoverQuantity: 100,
    handoverDepositTotal: 100_000,
    returnedAccepted: 50,
    returnedDamaged: 0,
    refundDueTotal: 50_000,
    paymentsGross: 40_000,
    paymentReversals: 5_000,
    paymentsNet: 35_000,
    refundsGross: 0,
    refundReversals: 0,
    refundsNet: 0,
    compensationAssessed: 0,
  },
  truncated: false,
};

const STOCK: StockReportDto = {
  generatedAt: AT,
  rows: [
    { item: A, quantityOnHand: 475, quantityOut: 75, damagedTotal: 0, minStock: null, isLowStock: false },
    { item: B, quantityOnHand: 90, quantityOut: 8, damagedTotal: 2, minStock: 90, isLowStock: true },
  ],
  totals: { quantityOnHand: 565, quantityOut: 83, damagedTotal: 2, lowStockCount: 1 },
};

async function mockReports(page: Page, user: MeDto = ADMIN) {
  await mockApi(page, user, 'en');
  const asked: URL[] = [];
  const answer = (json: unknown) => (route: Route) => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({ json });
  };
  await page.route(/\/api\/reports\/positions/, answer(POSITIONS));
  await page.route(/\/api\/reports\/purchases/, answer(PURCHASES));
  await page.route(/\/api\/reports\/activity/, answer(ACTIVITY));
  await page.route(/\/api\/reports\/stock/, answer(STOCK));
  return asked;
}

test('Reports opens the first report the user may view, and its tabs name only those', async ({ page }) => {
  const stocker: MeDto = { ...ADMIN, id: 2, role: 'EMPLOYEE', permissions: ['reports.viewStock', 'items.view'] };
  await mockReports(page, stocker);

  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Reports' }).click();

  await expect(page).toHaveURL(/\/reports\/stock/);
  const tabs = page.getByRole('navigation', { name: 'Reports' });
  await expect(tabs.getByRole('link')).toHaveCount(1);
});

test('positions: a row per customer, expanded per item, sorted on the page, with totals', async ({ page }) => {
  await mockReports(page);
  await page.goto('/reports/positions');

  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /Ashti Blocks/ })).toContainText('40,000');
  await expect(table.locator('tfoot')).toContainText('83');
  await expect(table.locator('tfoot')).toContainText('95,000');

  await table
    .getByRole('row', { name: /Baban Cement/ })
    .getByRole('button', { name: /Pallets per item/ })
    .click();
  await expect(
    table.getByRole('row', { name: /Baban Cement/ }).getByRole('button', { name: /Pallets per item/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(table).toContainText('Pallet B');

  await table.getByRole('button', { name: 'Pallets out' }).click();
  await expect(page).toHaveURL(/sort=palletsOut/);
  await expect(table.locator('tbody tr').first()).toContainText('Baban Cement');
});

test('purchases: this month by default, per-item subtotals, and a reversed range on its field', async ({ page }) => {
  const asked = await mockReports(page);
  await page.goto('/reports/purchases');

  const table = page.getByRole('table');
  await expect(table).toContainText('Second truck');
  await expect(table.getByRole('row', { name: /Subtotal.*Pallet A/ })).toContainText('390,000');
  await expect(table.locator('tfoot')).toContainText('460,000');
  const first = asked.find((url) => url.pathname.endsWith('/purchases'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
  expect(first?.searchParams.get('dateTo')).toBe(today);
  expect(first?.searchParams.get('dateFrom')).toBe(`${today.slice(0, 8)}01`);

  await page.goto('/reports/purchases?dateFrom=2026-09-10&dateTo=2026-09-01');
  await expect(page.getByRole('alert').filter({ hasText: 'The start date is after the end date' })).toBeVisible();
});

test('activity: a table per section, reversals as their own marked rows, money left out for one item', async ({
  page,
}) => {
  await mockReports(page);
  await page.goto('/reports/activity?dateFrom=2026-09-01&dateTo=2026-09-12');

  const payments = page.getByRole('table', { name: 'Payments' });
  await expect(payments.getByRole('row')).toHaveCount(4);
  await expect(payments.locator('tbody tr').filter({ hasText: 'Payment reversed' })).toContainText('Reversal');
  await expect(payments.locator('tfoot')).toContainText('35,000');
  await expect(page.getByRole('table', { name: 'Hand-overs' }).locator('tfoot')).toContainText('100,000');

  await page.route(/\/api\/reports\/activity/, (route) =>
    route.fulfill({
      json: { ...ACTIVITY, moneyOmitted: true, payments: [], refunds: [], filters: { ...ACTIVITY.filters, itemId: 5 } },
    }),
  );
  await page.goto('/reports/activity?dateFrom=2026-09-01&dateTo=2026-09-12&itemId=5');
  await expect(page.getByText('Payments and refunds are recorded per order')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Payments' })).toHaveCount(0);
});

test('stock: per item with the low-stock flag in words, and totals', async ({ page }) => {
  await mockReports(page);
  await page.goto('/reports/stock');

  const low = page.getByRole('row', { name: /Pallet B/ });
  await expect(low).toContainText('Low stock');
  await expect(low.locator('svg').first()).toBeVisible();
  await expect(page.getByRole('table').locator('tfoot')).toContainText('565');
});

test('printed, a report drops the app around it, names itself and repeats its column headers', async ({ page }) => {
  await mockReports(page);
  await page.goto('/reports/stock');
  await expect(page.getByRole('table')).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('aside').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  const header = page.locator('[data-print="only"]');
  await expect(header).toBeVisible();
  await expect(header).toContainText('Stock levels');
  expect(
    await page
      .locator('thead')
      .first()
      .evaluate((element) => getComputedStyle(element).display),
  ).toBe('table-header-group');
});

test('a snapshot report shows the order it arrived in, and the first click on that column turns it', async ({
  page,
}) => {
  await mockReports(page);
  await page.goto('/reports/positions');

  const owed = page.getByRole('columnheader', { name: 'Owed' });
  await expect(owed).toHaveAttribute('aria-sort', 'descending');
  await owed.getByRole('button').click();
  await expect(page).toHaveURL(/sort=owed(&|$)/);
  await expect(owed).toHaveAttribute('aria-sort', 'ascending');
});

test('a report offers no picker or link its viewer could not use', async ({ page }) => {
  const viewer: MeDto = {
    ...ADMIN,
    id: 2,
    role: 'EMPLOYEE',
    permissions: ['reports.viewPositions', 'reports.viewActivity', 'reports.viewStock'],
  };
  await mockReports(page, viewer);

  await page.goto('/reports/positions');
  const positions = page.getByRole('table');
  await expect(positions.getByRole('row', { name: /Ashti Blocks/ })).toBeVisible();
  await expect(positions.getByRole('link', { name: 'Ashti Blocks' })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);

  await page.goto('/reports/activity?dateFrom=2026-09-01&dateTo=2026-09-12');
  await expect(page.getByRole('table', { name: 'Hand-overs' })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);

  await page.goto('/reports/stock');
  await expect(page.getByRole('row', { name: /Pallet B/ })).toBeVisible();
  await expect(page.getByRole('table').getByRole('link')).toHaveCount(0);
});

test('a long report keeps its column headers and totals in view on screen', async ({ page }) => {
  await mockReports(page);
  const rows = Array.from({ length: 80 }, (_, index) => ({
    ...(STOCK.rows[0] as StockReportDto['rows'][number]),
    item: { ...A, id: 100 + index, name: `Pallet ${100 + index}` },
  }));
  await page.route(/\/api\/reports\/stock/, (route) => route.fulfill({ json: { ...STOCK, rows } }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/reports/stock');
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /Pallet 179/ })).toBeAttached();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await table.locator('xpath=..').evaluate((box) => box.scrollTo(0, box.scrollHeight));

  await expect(table.locator('thead')).toBeInViewport();
  await expect(table.locator('tfoot')).toBeInViewport();
  await expect(table.getByRole('row', { name: /Pallet 179/ })).toBeInViewport();
});

test('printed, the header lists every applied filter and the total closes the table once', async ({ page }) => {
  await mockReports(page);
  await page.goto('/reports/activity?dateFrom=2026-09-01&dateTo=2026-09-12&customerId=3&itemId=5&driverId=2');
  await expect(page.getByRole('table', { name: 'Hand-overs' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });

  const header = page.locator('[data-print="only"]');
  await expect(header).toContainText('From 01/09/2026 to 12/09/2026');
  await expect(header).toContainText(/Customer: .+/);
  await expect(header).toContainText(/Item: .+/);
  await expect(header).toContainText(/Driver: .+/);

  const table = page.getByRole('table', { name: 'Hand-overs' });
  // Repeated on every page, the grand total would read as each page's subtotal.
  expect(await table.locator('tfoot').evaluate((element) => getComputedStyle(element).display)).toBe('table-row-group');
  // On paper the table is as long as its rows; the screen's scroll box would cut it off.
  expect(await table.locator('xpath=..').evaluate((box) => getComputedStyle(box).maxHeight)).toBe('none');

  await page.goto('/reports/stock?lowStockOnly=true&includeArchived=true');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(header).toContainText('Only low stock');
  await expect(header).toContainText('Include archived');
});

test('printed in Kurdish, only the timestamp of "generated" runs left to right', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  await page.route(/\/api\/reports\/stock/, (route) => route.fulfill({ json: STOCK }));
  await page.goto('/reports/stock');
  await expect(page.getByRole('table')).toBeVisible();
  await page.emulateMedia({ media: 'print' });

  const header = page.locator('[data-print="only"]');
  await expect(header).toBeVisible();
  const ltr = header.locator('[dir="ltr"]');
  await expect(ltr).toHaveCount(1);
  await expect(ltr).toHaveText(/^[\d/:\s]+$/);
});

test('report counts are grouped like every other number', async ({ page }) => {
  await mockReports(page);
  await page.route(/\/api\/reports\/stock/, (route) =>
    route.fulfill({ json: { ...STOCK, totals: { ...STOCK.totals, lowStockCount: 1200 } } }),
  );
  await page.goto('/reports/stock');
  await expect(page.getByRole('table').locator('tfoot')).toContainText('Low: 1,200');
});
