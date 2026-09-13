import type { DashboardDto, MeDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, CUSTOMER, ORDER, mockApi } from './mock-api';

const customer = { id: CUSTOMER.id, name: CUSTOMER.name, phone: CUSTOMER.phone, archived: false };
const FULL: DashboardDto = {
  positions: {
    palletsOut: 48_250,
    outValue: 603_125_000,
    owed: 120_000_000,
    held: 90_000_000,
    openOrderCount: 12,
    customersWithOpenOrders: 5,
  },
  lowStock: {
    count: 2,
    items: [
      { id: 5, name: 'Euro pallet', imageUrl: null, quantityOnHand: 40, minStock: 100 },
      { id: 6, name: 'Half pallet', imageUrl: null, quantityOnHand: 90, minStock: 90 },
    ],
  },
  recentActivity: [
    {
      kind: 'PAYMENT',
      at: '2026-09-12T10:00:00.000Z',
      date: '2026-09-12',
      orderId: ORDER.id,
      orderNumber: 42,
      customer,
      quantity: null,
      amount: 40_000,
      reversed: true,
    },
    {
      kind: 'RETURN',
      at: '2026-09-12T09:00:00.000Z',
      date: '2026-09-12',
      orderId: ORDER.id,
      orderNumber: 42,
      customer,
      quantity: 55,
      amount: 50_000,
      reversed: false,
    },
    {
      kind: 'HANDOVER',
      at: '2026-09-11T08:00:00.000Z',
      date: '2026-09-11',
      orderId: ORDER.id,
      orderNumber: 42,
      customer,
      quantity: 100,
      amount: 100_000,
      reversed: false,
    },
  ],
};

async function openDashboard(page: Page, dashboard: DashboardDto, user: MeDto = ADMIN) {
  await mockApi(page, user, 'en');
  await page.route(/\/api\/dashboard$/, (route) => route.fulfill({ json: dashboard }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

test('the dashboard sums up positions, links each figure to its report and counts up to it', async ({ page }) => {
  await openDashboard(page, FULL);

  const palletsOut = page.getByRole('link', { name: /Pallets out/ });
  await expect(palletsOut).toContainText('48,250');
  await expect(palletsOut).toHaveAttribute('href', '/reports/positions');
  await expect(page.getByRole('link', { name: /Total owed/ })).toContainText('120,000,000');
  await expect(page.getByRole('link', { name: /Total owed/ })).toHaveAttribute('href', '/reports/positions?sort=-owed');
  await expect(page.getByRole('link', { name: /Total held/ })).toHaveAttribute('href', '/reports/positions?sort=-held');

  const lowStock = page.getByRole('link', { name: /Low stock items/ });
  await expect(lowStock).toHaveAttribute('href', '/items?lowStockOnly=true');
  await expect(lowStock).toContainText('Needs restocking');
  await expect(lowStock).toContainText('Euro pallet');
});

test('under reduced motion the figures show their value at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page, FULL);

  // Read straight after the first paint: no count-up in between.
  await expect(page.getByRole('link', { name: /Pallets out/ })).toContainText('48,250', { timeout: 150 });
});

test('recent activity lists the latest events, marks reversals, and opens the order', async ({ page }) => {
  await openDashboard(page, FULL);

  const events = page.getByRole('list', { name: 'Recent activity' }).getByRole('listitem');
  await expect(events).toHaveCount(3);
  await expect(events.nth(0)).toContainText('Payment');
  await expect(events.nth(0)).toContainText('Reversed');
  await expect(events.nth(0)).toContainText('40,000');
  await expect(events.nth(1)).toContainText('Return');
  await expect(events.nth(2)).toContainText('Hand-over');

  await events
    .nth(2)
    .getByRole('link', { name: /#000042/ })
    .click();
  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('quick actions follow the permissions, and sections the viewer may not see are not drawn', async ({ page }) => {
  const clerk: MeDto = {
    ...ADMIN,
    id: 2,
    role: 'EMPLOYEE',
    permissions: ['orders.view', 'orders.create', 'customers.view', 'drivers.view', 'items.view'],
  };
  await openDashboard(page, { recentActivity: [] }, clerk);

  await expect(page.getByRole('link', { name: 'New order' })).toHaveAttribute('href', '/orders/new');
  await expect(page.getByRole('link', { name: 'Record return' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Pallets out/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Low stock items/ })).toHaveCount(0);
  await expect(page.getByText('Nothing recorded yet')).toBeVisible();
});

test('a click anywhere on a recent-activity row opens its order', async ({ page }) => {
  await openDashboard(page, FULL);

  const events = page.getByRole('list', { name: 'Recent activity' }).getByRole('listitem');
  await events.nth(2).getByText('Hand-over').click();
  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('the dashboard is fetched again when it is opened 15 seconds after its last answer (§7.8)', async ({ page }) => {
  await page.clock.install();
  let answers = 0;
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/dashboard$/, (route) => {
    answers += 1;
    return route.fulfill({ json: FULL });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Pallets out/ })).toBeVisible();
  expect(answers).toBe(1);

  await page.getByRole('navigation').getByRole('link', { name: 'Orders' }).first().click();
  await expect(page).toHaveURL(/\/orders/);
  await page.clock.fastForward(16_000);
  await page.getByRole('navigation').getByRole('link', { name: 'Dashboard' }).first().click();

  await expect(page.getByRole('link', { name: /Pallets out/ })).toBeVisible();
  await expect.poll(() => answers).toBe(2);
});
