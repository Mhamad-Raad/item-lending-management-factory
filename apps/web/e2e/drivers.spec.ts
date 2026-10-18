import { expect, test, type Page } from './fixtures';
import { ADMIN as MOCK_ADMIN, AUDIT_ROW, DRIVER as MOCK_DRIVER, ORDER as MOCK_ORDER, mockApi } from './mock-api';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

const DRIVER = {
  id: 4,
  name: 'Karwan Aziz',
  phone: '07701112233',
  carNumber: 'Erbil 12 A 34567',
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-12T08:00:00.000Z',
  updatedAt: '2026-09-12T08:00:00.000Z',
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

test('a driver is added from the dialog, and the list shows them', async ({ page }) => {
  await signIn(page);
  let created: unknown;
  await page.route(/\/api\/drivers(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: DRIVER });
    }
    const items = created ? [DRIVER] : [];
    return route.fulfill({ json: { items, page: 1, pageSize: 25, total: items.length } });
  });

  await page.goto('/drivers');
  await page.getByRole('button', { name: 'New driver' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Karwan Aziz');
  await dialog.getByLabel('Phone').fill('0770 111-2233');
  await dialog.getByLabel('Car number').fill('Erbil 12 A 34567');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  expect(created).toEqual({
    name: 'Karwan Aziz',
    phone: '07701112233',
    carNumber: 'Erbil 12 A 34567',
    confirmDuplicatePhone: false,
  });
  await expect(page.getByRole('table', { name: 'Drivers' }).getByText('Karwan Aziz')).toBeVisible();
});

/**
 * Archiving the last driver of the last page, or a bookmark to a page that no longer exists, leaves
 * a page with no rows although the list has some. It must not read as "no drivers yet".
 */
test('a page past the end of the list steps back to the last page', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/drivers(\?.*)?$/, (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') ?? '1');
    return route.fulfill({
      json:
        pageNumber > 1
          ? { items: [], page: pageNumber, pageSize: 25, total: 1 }
          : { items: [DRIVER], page: 1, pageSize: 25, total: 1 },
    });
  });

  await page.goto('/drivers?page=2');

  await expect(page.getByRole('table', { name: 'Drivers' }).getByText('Karwan Aziz')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).not.toBe('2');
});

const ORDER_ROW = {
  id: 9,
  orderNumber: 42,
  date: '2026-09-11',
  paymentType: 'LENT',
  status: 'SETTLED',
  customer: { id: 7, name: 'Kurdistan Cement', phone: '07501234567', archived: false },
  driver: { id: 4, name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567', archived: false },
  depositTotal: 100_000,
  owed: 0,
  outValue: 0,
  held: 0,
  outQuantityTotal: 0,
  createdAt: '2026-09-11T08:00:00.000Z',
};

test("Q149: a row opens the driver's page, with their details and every order they were given", async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/drivers(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [DRIVER], page: 1, pageSize: 25, total: 1 } }),
  );
  await page.route(/\/api\/drivers\/4$/, (route) => route.fulfill({ json: DRIVER }));
  const orderQueries: URLSearchParams[] = [];
  await page.route(/\/api\/orders\?/, (route) => {
    orderQueries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { items: [ORDER_ROW], page: 1, pageSize: 25, total: 1 } });
  });

  await page.goto('/drivers');
  await page.getByRole('table', { name: 'Drivers' }).getByRole('link', { name: 'Karwan Aziz' }).click();

  await expect(page).toHaveURL(/\/drivers\/4$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Karwan Aziz' })).toBeVisible();
  await expect(page.getByText('07701112233')).toBeVisible();
  await expect(page.getByText('Erbil 12 A 34567')).toBeVisible();

  const orders = page.getByRole('table', { name: 'Orders' });
  await expect(orders.getByRole('link', { name: '#000042' })).toBeVisible();
  // Every order, settled ones included, and only this driver's.
  expect(orderQueries.at(-1)?.get('driverId')).toBe('4');
  expect(orderQueries.at(-1)?.get('status')).toBe('ALL');
  // The driver's own name is not repeated on every row; the customer is.
  await expect(orders.getByRole('columnheader', { name: 'Customer' })).toBeVisible();
  await expect(orders.getByRole('columnheader', { name: 'Driver' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Open' }).click();
  await expect.poll(() => orderQueries.at(-1)?.get('status')).toBe('OPEN');
});

test("Q149: Edit on the driver's page saves through the dialog and the page shows what was saved", async ({ page }) => {
  await signIn(page);
  let current = DRIVER;
  let sent: unknown;
  await page.route(/\/api\/drivers\/4$/, (route) => {
    if (route.request().method() === 'PATCH') {
      sent = route.request().postDataJSON();
      current = { ...DRIVER, carNumber: 'Duhok 22 B 1000', version: 2 };
      return route.fulfill({ json: current });
    }
    return route.fulfill({ json: current });
  });
  await page.route(/\/api\/drivers\/phone-check/, (route) => route.fulfill({ json: { matches: [] } }));
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } }),
  );

  await page.goto('/drivers/4');
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Name')).toHaveValue('Karwan Aziz');
  await dialog.getByLabel('Car number').fill('Duhok 22 B 1000');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  expect(sent).toEqual({
    version: 1,
    name: 'Karwan Aziz',
    phone: '07701112233',
    carNumber: 'Duhok 22 B 1000',
    confirmDuplicatePhone: false,
  });
  await expect(page.getByText('Duhok 22 B 1000')).toBeVisible();
});

test("Q149: an archived driver's page says so and offers no edit", async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/drivers\/4$/, (route) =>
    route.fulfill({ json: { ...DRIVER, archivedAt: '2026-09-20T08:00:00.000Z' } }),
  );
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({ json: { items: [ORDER_ROW], page: 1, pageSize: 25, total: 1 } }),
  );

  await page.goto('/drivers/4');

  await expect(page.getByText('This driver is archived and can no longer be chosen for new orders.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Orders' }).getByRole('link', { name: '#000042' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

test("Q149: an order's driver and a driver's history entry open the driver's page", async ({ page }) => {
  await mockApi(page, MOCK_ADMIN, 'en');
  await page.route(/\/api\/audit-logs(\?.*)?$/, (route) =>
    route.fulfill({
      json: { items: [{ ...AUDIT_ROW, entityType: 'DRIVER', entityId: '4' }], page: 1, pageSize: 50, total: 1 },
    }),
  );

  await page.goto('/orders/9');
  await page.getByRole('link', { name: MOCK_DRIVER.name }).click();
  await expect(page).toHaveURL(/\/drivers\/4$/);

  await page.goto('/history');
  await expect(page.getByRole('link', { name: '#4' }).first()).toHaveAttribute('href', '/drivers/4');
});

test('Q149: on a phone, a card menu action stays on the list instead of opening the driver', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.route(/\/api\/drivers(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [DRIVER], page: 1, pageSize: 25, total: 1 } }),
  );

  await page.goto('/drivers');
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(page.getByRole('dialog', { name: /Archive/ })).toBeVisible();
  await expect(page).toHaveURL(/\/drivers(\?.*)?$/);
});

test('Q149: after a driver is edited, going back to an order shows the driver as saved', async ({ page }) => {
  await mockApi(page, MOCK_ADMIN, 'en');
  await page.route(/\/api\/drivers\/phone-check/, (route) => route.fulfill({ json: { matches: [] } }));
  let carNumber = MOCK_DRIVER.carNumber;
  await page.route(/\/api\/drivers\/4$/, (route) => {
    if (route.request().method() === 'PATCH') carNumber = 'Duhok 22 B 1000';
    return route.fulfill({ json: { ...MOCK_DRIVER, carNumber, version: carNumber === MOCK_DRIVER.carNumber ? 1 : 2 } });
  });
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({ json: { ...MOCK_ORDER, driver: { ...MOCK_ORDER.driver, carNumber } } }),
  );

  await page.goto('/orders/9');
  await page.getByRole('link', { name: MOCK_DRIVER.name }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Car number').fill('Duhok 22 B 1000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goBack();

  await expect(page).toHaveURL(/\/orders\/9$/);
  await expect(page.getByText('Duhok 22 B 1000')).toBeVisible();
});

test('Q149: selecting a phone number in a row to copy it stays on the list', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/drivers(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [DRIVER], page: 1, pageSize: 25, total: 1 } }),
  );

  await page.goto('/drivers');
  const phone = page.getByRole('table', { name: 'Drivers' }).getByText(DRIVER.phone);
  const box = await phone.boundingBox();
  if (!box) throw new Error('the phone is not on screen');
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('0770');
  await expect(page).toHaveURL(/\/drivers(\?.*)?$/);
});
