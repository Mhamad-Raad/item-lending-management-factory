import { expect, test, type Page } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

const MATCH = { customerId: 3, name: 'Old Blocks', archived: true, matchedField: 'phone' };

const CUSTOMER = {
  id: 7,
  name: 'Kurdistan Cement',
  phone: '07501234567',
  altPhone: null,
  address: 'Erbil, 100 m road',
  creditLimit: null,
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-12T08:00:00.000Z',
  updatedAt: '2026-09-12T08:00:00.000Z',
  summary: {
    palletsOut: 0,
    outValue: 0,
    owed: 0,
    held: 0,
    compensation: 0,
    creditLimit: null,
    headroom: null,
    openOrderCount: 0,
  },
  holdings: [],
  palletsOutByItem: [],
};

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
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
}

/**
 * A shared phone is a warning, never a block (A13): the form says so while typing, the save is
 * refused once with the matches, and "Save anyway" sends the same customer again, confirmed.
 */
test('a phone another customer holds is warned about, then saved once confirmed', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/customers\/phone-check\?/, (route) =>
    route.fulfill({ json: { normalizedPhone: '07501234567', matches: [MATCH] } }),
  );
  const sent: Record<string, unknown>[] = [];
  await page.route(/\/api\/customers$/, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    return body.confirmDuplicatePhone
      ? route.fulfill({ status: 201, json: CUSTOMER })
      : route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'CUSTOMER_PHONE_DUPLICATE',
              details: { matches: [{ ...MATCH, matchedValue: '07501234567' }] },
            },
          },
        });
  });
  await page.route(/\/api\/customers\/7$/, (route) => route.fulfill({ json: CUSTOMER }));

  await page.goto('/customers/new');
  await page.getByLabel('Name').fill('Kurdistan Cement');
  await page.getByLabel('Phone', { exact: true }).fill('0750 123-4567');
  await expect(page.getByRole('status').filter({ hasText: 'This number is already used by:' })).toContainText(
    'Old Blocks',
  );
  await page.getByLabel('Address').fill('Erbil, 100 m road');
  await page.getByRole('button', { name: 'Save' }).click();

  const dialog = page.getByRole('dialog');
  // The name sits between isolate marks inside the sentence (Q43).
  await expect(dialog).toContainText(/It belongs to \u2068Old Blocks\u2069/);
  await dialog.getByRole('button', { name: 'Save anyway' }).click();

  await expect(page.getByRole('heading', { name: 'Kurdistan Cement' })).toBeVisible();
  expect(sent.map((body) => body.confirmDuplicatePhone)).toEqual([false, true]);
  // The same customer both times, its phone as the shared schema normalised it.
  expect(sent[1]).toMatchObject({ name: 'Kurdistan Cement', phone: '07501234567', altPhone: null, creditLimit: null });
});

test('phone numbers on the profile read left to right, whatever the language', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/customers\/7$/, (route) =>
    route.fulfill({ json: { ...CUSTOMER, altPhone: '+9647701112233' } }),
  );

  await page.goto('/customers/7');

  await expect(page.getByText('+9647701112233', { exact: true })).toHaveAttribute('dir', 'ltr');
  await expect(page.getByText('07501234567', { exact: true })).toHaveAttribute('dir', 'ltr');
});

test('customers sort by when they were added', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/customers(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [CUSTOMER], page: 1, pageSize: 25, total: 1 } }),
  );

  await page.goto('/customers');
  await page.getByRole('button', { name: 'Added' }).click();

  await expect(page).toHaveURL(/sort=createdAt/);
});

const ORDER_ROW = {
  id: 9,
  orderNumber: 42,
  date: '2026-09-11',
  paymentType: 'LENT',
  status: 'OPEN',
  customer: { id: 7, name: 'Kurdistan Cement', phone: '07501234567', archived: false },
  driver: { id: 4, name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567', archived: false },
  depositTotal: 100_000,
  owed: 100_000,
  outValue: 100_000,
  held: 0,
  outQuantityTotal: 100,
  createdAt: '2026-09-11T08:00:00.000Z',
};

test('a customer profile offers a new order for them and lists their orders and money', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/customers\/7$/, (route) => route.fulfill({ json: CUSTOMER }));
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({ json: { items: [ORDER_ROW], page: 1, pageSize: 25, total: 1 } }),
  );
  const ledgerQueries: string[] = [];
  await page.route(/\/api\/ledger-entries\?/, (route) => {
    ledgerQueries.push(decodeURIComponent(new URL(route.request().url()).search));
    return route.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } });
  });

  await page.goto('/customers/7');

  await expect(page.getByRole('link', { name: 'New order' })).toHaveAttribute('href', '/orders/new?customerId=7');
  await page.getByRole('tab', { name: 'Orders' }).click();
  await expect(page.getByRole('link', { name: '#000042' })).toBeVisible();
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect.poll(() => ledgerQueries.some((query) => query.includes('type=PAYMENT,PAYMENT_REVERSAL'))).toBe(true);
  expect(ledgerQueries.every((query) => query.includes('customerId=7'))).toBe(true);
});

test('a customer profile opens on their history: hand-overs, returns and money, newest first', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/customers\/7$/, (route) => route.fulfill({ json: CUSTOMER }));
  const item = { id: 5, name: 'Euro pallet', imageUrl: null, archived: false };
  const history = [
    {
      kind: 'LEDGER',
      date: '2026-09-12',
      createdAt: '2026-09-12T08:00:00.000Z',
      ledgerEntryId: 11,
      orderId: 9,
      orderNumber: 42,
      type: 'PAYMENT',
      source: 'MANUAL',
      amount: 40_000,
      isAutomatic: false,
      reversesEntryId: null,
      note: null,
    },
    {
      kind: 'RETURN',
      date: '2026-09-11',
      createdAt: '2026-09-11T09:00:00.000Z',
      returnId: 5,
      orderId: 9,
      orderNumber: 42,
      reversed: true,
      reversalKind: 'DELETE',
      replacedByReturnId: null,
      lines: [{ item, acceptedQuantity: 20, damagedQuantity: 2, damagedRefund: 0 }],
      acceptedTotal: 20,
      damagedTotal: 2,
      refundDue: 20_000,
      cashRefund: 0,
    },
    {
      kind: 'HANDOVER',
      date: '2026-09-10',
      createdAt: '2026-09-10T08:00:00.000Z',
      orderId: 9,
      orderNumber: 42,
      paymentType: 'LENT',
      status: 'OPEN',
      cancelled: false,
      driver: ORDER_ROW.driver,
      lines: [{ item, quantity: 100, unitDeposit: 1_000, lineTotal: 100_000 }],
      quantityTotal: 100,
      depositTotal: 100_000,
    },
  ];
  const asked: string[] = [];
  await page.route(/\/api\/customers\/7\/history/, (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { items: history, page: 1, pageSize: 25, total: 3 } });
  });

  await page.goto('/customers/7');

  const timeline = page.getByRole('list', { name: 'History' });
  const entries = timeline.getByRole('listitem');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('Payment');
  await expect(entries.nth(0)).toContainText('40,000');
  await expect(entries.nth(1)).toContainText('Deleted');
  await expect(entries.nth(1)).toContainText('20');
  await expect(entries.nth(2)).toContainText('100');
  await expect(entries.nth(2).getByRole('link', { name: '#000042' })).toHaveAttribute('href', '/orders/9');
  expect(asked[0]).toContain('page=1');
});

test('each order a holding came out on links to that order', async ({ page }) => {
  await signIn(page);
  const item = { id: 5, name: 'Euro pallet', imageUrl: null, archived: false };
  await page.route(/\/api\/customers\/7$/, (route) =>
    route.fulfill({
      json: {
        ...CUSTOMER,
        holdings: [
          {
            item,
            quantityOut: 20,
            outValue: 20_000,
            sources: [{ orderId: 9, orderNumber: 42, orderDate: '2026-09-11', quantityOut: 20, unitDeposit: 1_000 }],
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/customers\/7\/history/, (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } }),
  );

  await page.goto('/customers/7');

  await expect(page.getByRole('link', { name: /#000042/ }).first()).toHaveAttribute('href', '/orders/9');
});
