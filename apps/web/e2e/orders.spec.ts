import { expect, test, type Page } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};
const CLERK = {
  id: 2,
  username: 'clerk',
  displayName: 'Clerk',
  role: 'EMPLOYEE',
  mustChangePassword: false,
  permissions: ['orders.view', 'orders.create', 'customers.view', 'drivers.view', 'items.view'],
};

/** §7.4.1's worked example: A at 1,000 with 500 on hand, B at 2,500 with 40. */
const ITEMS = [
  { id: 1, name: 'Pallet A', depositPrice: 1_000, quantityOnHand: 500 },
  { id: 2, name: 'Pallet B', depositPrice: 2_500, quantityOnHand: 40 },
].map((item) => ({
  ...item,
  imageUploadId: null,
  imageUrl: null,
  minStock: null,
  isLowStock: false,
  quantityOut: 0,
  damagedTotal: 0,
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
}));

/** A limit of 300,000 with 200,000 already out: the example order of 125,000 passes it by 25,000. */
const CUSTOMER = {
  id: 3,
  name: 'Kurdistan Cement',
  phone: '07501234567',
  altPhone: null,
  address: 'Erbil',
  creditLimit: 300_000,
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  summary: {
    palletsOut: 200,
    outValue: 200_000,
    owed: 200_000,
    held: 0,
    compensation: 0,
    creditLimit: 300_000,
    headroom: 100_000,
    openOrderCount: 1,
  },
  holdings: [],
  palletsOutByItem: [],
};

const DRIVER = {
  id: 4,
  name: 'Karwan Aziz',
  phone: '07701112233',
  carNumber: 'Erbil 12 A 34567',
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

const ORDER = {
  id: 9,
  orderNumber: 42,
  date: '2026-09-11',
  paymentType: 'LENT',
  status: 'OPEN',
  customer: { id: 3, name: 'Kurdistan Cement', phone: '07501234567', archived: false },
  driver: { id: 4, name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567', archived: false },
  depositTotal: 125_000,
  owed: 125_000,
  outValue: 125_000,
  held: 0,
  outQuantityTotal: 110,
  createdAt: '2026-09-11T08:00:00.000Z',
  notes: null,
  paymentsNet: 0,
  creditsTotal: 0,
  refundsNet: 0,
  compensation: 0,
  cancelledAt: null,
  cancelledBy: null,
  creditOverride: null,
  lines: [],
  returns: [],
  ledgerEntries: [],
  canEditLines: true,
  canCancel: true,
  version: 1,
  updatedAt: '2026-09-11T08:00:00.000Z',
  createdBy: { id: 1, username: 'admin', displayName: 'Admin' },
};

const page1 = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

async function mockApi(
  page: Page,
  user: typeof ADMIN | typeof CLERK,
  language = 'en',
): Promise<Record<string, unknown>[]> {
  await page.addInitScript((lang) => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: lang }));
  }, language);
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user },
    }),
  );
  await page.route(/\/api\/customers\?/, (route) => route.fulfill({ json: page1([CUSTOMER]) }));
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: CUSTOMER }));
  await page.route(/\/api\/drivers\?/, (route) => route.fulfill({ json: page1([DRIVER]) }));
  await page.route(/\/api\/drivers\/4$/, (route) => route.fulfill({ json: DRIVER }));
  await page.route(/\/api\/items\?/, (route) => route.fulfill({ json: page1(ITEMS) }));
  await page.route(/\/api\/items\/(\d+)$/, (route) => {
    const itemId = Number(/\/items\/(\d+)$/.exec(route.request().url())?.[1]);
    return route.fulfill({ json: ITEMS.find((item) => item.id === itemId) });
  });
  const sent: Record<string, unknown>[] = [];
  await page.route(/\/api\/orders$/, (route) => {
    sent.push({ ...(route.request().postDataJSON() as object), key: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: 201, json: ORDER });
  });
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: ORDER }));
  return sent;
}

async function choose(page: Page, fieldLabel: string | RegExp, option: string): Promise<void> {
  await page.getByRole('combobox', { name: fieldLabel }).first().click();
  await page.getByRole('option', { name: new RegExp(option) }).click();
}

/** Fills the §7.4.1 example: customer, driver, lent, A × 100 and B × 10. */
async function fillExampleOrder(page: Page): Promise<void> {
  await page.goto('/orders/new');
  await choose(page, 'Customer', 'Kurdistan Cement');
  await choose(page, 'Driver', 'Karwan Aziz');
  await page.getByRole('radio', { name: 'Lent' }).click();
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();
  await page.locator('#lines-0-quantity').fill('100');
  // Enter in the last row's quantity adds a row instead of submitting.
  await page.locator('#lines-0-quantity').press('Enter');
  await expect(page.locator('#lines-1-item')).toBeFocused();
  // The first row's list may still be fading out; its options would match the second row's too.
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.locator('#lines-1-item').click();
  await page.getByRole('option', { name: /Pallet B/ }).click();
  await page.locator('#lines-1-quantity').fill('10');
}

test('E2: the deposit total, the credit headroom and the limit follow the lines as they are typed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sent = await mockApi(page, CLERK);

  await fillExampleOrder(page);

  const summary = page.getByRole('complementary', { name: 'Summary' });
  await expect(summary).toContainText('125,000');
  await expect(summary).toContainText('25,000');
  await expect(summary.getByRole('alert')).toContainText('passes it by 25,000');
  // An employee cannot pass the limit.
  await expect(summary.getByRole('button', { name: 'Hand over' })).toBeDisabled();
  expect(sent).toEqual([]);
});

test('an admin confirms an order past the credit limit, and lands on it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sent = await mockApi(page, ADMIN);

  await fillExampleOrder(page);
  await page
    .getByRole('complementary', { name: 'Summary' })
    .getByRole('button', { name: 'Hand over past the limit' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hand over past the limit' }).click();

  await expect(page).toHaveURL(/\/orders\/9\?created=true$/);
  await expect(page.getByText('Order #000042 is recorded.')).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    customerId: 3,
    driverId: 4,
    paymentType: 'LENT',
    lines: [
      { itemId: 1, quantity: 100 },
      { itemId: 2, quantity: 10 },
    ],
    confirmCreditOverride: true,
  });
  expect(String(sent[0]?.key)).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
});

test('E2: the new-order page reads right to left in Kurdish', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');

  await page.goto('/orders/new');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');
  await expect(page.getByRole('heading', { name: 'داواکاری نوێ' })).toBeVisible();
});

test('E8: an employee without orders.cancel is offered no Cancel button', async ({ page }) => {
  await mockApi(page, CLERK);

  await page.goto('/orders/9');

  await expect(page.getByRole('heading', { name: '#000042' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
});

test('the new-order page fits a phone screen, its summary in a bar at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, ADMIN);

  await page.goto('/orders/new');
  await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Hand over' })).toBeVisible();
});

test('a credit refusal from the server lasts only while the order is still the one refused', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, CLERK);
  // The page believes there is no limit; a concurrent order made the server think otherwise.
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: { ...CUSTOMER, creditLimit: null } }));
  await page.route(/\/api\/orders$/, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'CREDIT_LIMIT_EXCEEDED',
          details: {
            creditLimit: 300_000,
            customerOutValue: 200_000,
            depositDelta: 125_000,
            excess: 25_000,
            canOverride: false,
          },
        },
      },
    }),
  );

  await fillExampleOrder(page);
  const summary = page.getByRole('complementary', { name: 'Summary' });
  await summary.getByRole('button', { name: 'Hand over' }).click();
  await expect(summary.getByRole('alert')).toContainText('passes it by 25,000');
  await expect(summary.getByRole('button', { name: 'Hand over' })).toBeDisabled();

  await page.locator('#lines-1-quantity').fill('5');

  await expect(summary.getByRole('alert')).toHaveCount(0);
  await expect(summary.getByRole('button', { name: 'Hand over' })).toBeEnabled();
});

test('the override is not offered until the order itself is complete', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, ADMIN);

  await page.goto('/orders/new');
  await choose(page, 'Customer', 'Kurdistan Cement');
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();
  await page.locator('#lines-0-quantity').fill('150');
  await page
    .getByRole('complementary', { name: 'Summary' })
    .getByRole('button', { name: 'Hand over past the limit' })
    .click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#driverId-error')).toBeVisible();
});

test('a picked item shows its current deposit and is not sent as an override', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sent = await mockApi(page, ADMIN);
  // The list still shows the old price; the item itself has a new one.
  await page.route(/\/api\/items\/1$/, (route) => route.fulfill({ json: { ...ITEMS[0], depositPrice: 1_200 } }));
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: { ...CUSTOMER, creditLimit: null } }));

  await page.goto('/orders/new');
  await choose(page, 'Customer', 'Kurdistan Cement');
  await choose(page, 'Driver', 'Karwan Aziz');
  await page.getByRole('radio', { name: 'Lent' }).click();
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();
  await page.locator('#lines-0-quantity').fill('10');

  await expect(page.locator('#lines-0-unitDeposit')).toHaveValue('1,200');
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Hand over' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.lines).toEqual([{ itemId: 1, quantity: 10 }]);
});

test('the deposit of a line can be cleared and typed again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sent = await mockApi(page, ADMIN);
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: { ...CUSTOMER, creditLimit: null } }));

  await page.goto('/orders/new');
  await choose(page, 'Customer', 'Kurdistan Cement');
  await choose(page, 'Driver', 'Karwan Aziz');
  await page.getByRole('radio', { name: 'Lent' }).click();
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();
  await page.locator('#lines-0-quantity').fill('10');

  const deposit = page.locator('#lines-0-unitDeposit');
  await deposit.fill('');
  await expect(deposit).toHaveValue('');
  await deposit.pressSequentially('900');
  await expect(deposit).toHaveValue('900');
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Hand over' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.lines).toEqual([{ itemId: 1, quantity: 10, unitDeposit: 900 }]);
});

test('a deposit box left empty goes back to the item deposit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, ADMIN);
  await page.goto('/orders/new');
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();

  const deposit = page.locator('#lines-0-unitDeposit');
  await deposit.fill('');
  await deposit.blur();
  await expect(deposit).toHaveValue('1,000');
});

test('orders sort by their out value under a column that shows it', async ({ page }) => {
  await mockApi(page, ADMIN);
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({ json: { items: [ORDER], page: 1, pageSize: 25, total: 1 } }),
  );

  await page.goto('/orders');
  await page.getByRole('button', { name: 'Out value' }).click();

  await expect(page).toHaveURL(/sort=outValue/);
  await expect(page.getByRole('columnheader', { name: 'Deposit held' }).getByRole('button')).toHaveCount(0);
});

test('the edit page describes a credit breach as the increase, not as the order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // A clerk who may edit orders, but not pass a credit limit.
  await mockApi(page, { ...CLERK, permissions: [...CLERK.permissions, 'orders.edit'] });
  const editable = {
    ...ORDER,
    depositTotal: 100_000,
    lines: [
      {
        id: 1,
        item: { id: 1, name: 'Pallet A', imageUrl: null, archived: false },
        quantity: 100,
        unitDeposit: 1_000,
        lineTotal: 100_000,
        returnedAccepted: 0,
        returnedDamaged: 0,
        outQuantity: 100,
      },
    ],
  };
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: editable }));
  await page.route(/\/api\/customers\/3$/, (route) =>
    route.fulfill({ json: { ...CUSTOMER, creditLimit: 105_000, summary: { ...CUSTOMER.summary, outValue: 100_000 } } }),
  );

  await page.goto('/orders/9/edit');
  await page.locator('#lines-0-quantity').fill('110');

  const alert = page.getByRole('complementary', { name: 'Summary' }).getByRole('alert');
  await expect(alert).toContainText('raising this order by 10,000');
  await expect(alert).toContainText('passes it by 5,000');
});

test('the new-order page starts on the customer picker', async ({ page }) => {
  await mockApi(page, ADMIN);

  await page.goto('/orders/new');

  await expect(page.getByRole('combobox', { name: 'Customer' })).toBeFocused();
});
