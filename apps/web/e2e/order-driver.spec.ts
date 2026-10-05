import { expect, test, type Page } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};
/** May take orders and see drivers, but not add one. */
const CLERK = {
  id: 2,
  username: 'clerk',
  displayName: 'Clerk',
  role: 'EMPLOYEE',
  mustChangePassword: false,
  permissions: ['orders.view', 'orders.create', 'customers.view', 'drivers.view', 'items.view'],
};

const STAMPS = {
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};
const ITEM = {
  id: 1,
  name: 'Pallet A',
  depositPrice: 1_000,
  quantityOnHand: 500,
  imageUploadId: null,
  imageUrl: null,
  minStock: null,
  isLowStock: false,
  quantityOut: 0,
  damagedTotal: 0,
  ...STAMPS,
};
const CUSTOMER = {
  id: 3,
  name: 'Kurdistan Cement',
  phone: '07501234567',
  altPhone: null,
  address: 'Erbil',
  creditLimit: null,
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
  ...STAMPS,
};
/** On file already. */
const KARWAN = { id: 4, name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567', ...STAMPS };
/** The one the dialog creates. */
const DILSHAD = { id: 5, name: 'Dilshad Omar', phone: '07502223344', carNumber: 'Duhok 21 B 555', ...STAMPS };
const KARWAN_MATCH = { driverId: 4, name: 'Karwan Aziz', carNumber: 'Erbil 12 A 34567', archived: false };

const page1 = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

interface Sent {
  drivers: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

/**
 * The reads of the new-order page, and a drivers API that knows one number: Karwan's. A driver posted with that
 * number is refused until confirmed, as the server does (Q135); any other is created as `created`.
 */
async function mockApi(page: Page, user: typeof ADMIN | typeof CLERK, created = DILSHAD): Promise<Sent> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user },
    }),
  );
  const sent: Sent = { drivers: [], orders: [] };
  await page.route(/\/api\/customers\?/, (route) => route.fulfill({ json: page1([CUSTOMER]) }));
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: CUSTOMER }));
  await page.route(/\/api\/items\?/, (route) => route.fulfill({ json: page1([ITEM]) }));
  await page.route(/\/api\/items\/1$/, (route) => route.fulfill({ json: ITEM }));
  await page.route(/\/api\/drivers\?/, (route) =>
    route.fulfill({ json: page1(sent.drivers.some((body) => !isRefused(body)) ? [KARWAN, created] : [KARWAN]) }),
  );
  await page.route(/\/api\/drivers\/4$/, (route) => route.fulfill({ json: KARWAN }));
  await page.route(/\/api\/drivers\/5$/, (route) => route.fulfill({ json: created }));
  await page.route(/\/api\/drivers\/phone-check\?/, (route) => {
    const phone = new URL(route.request().url()).searchParams.get('phone');
    return route.fulfill({
      json: { normalizedPhone: phone, matches: phone === KARWAN.phone ? [KARWAN_MATCH] : [] },
    });
  });
  const isRefused = (body: Record<string, unknown>): boolean =>
    body.phone === KARWAN.phone && body.confirmDuplicatePhone !== true;
  await page.route(/\/api\/drivers$/, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.drivers.push(body);
    if (isRefused(body)) {
      return route.fulfill({
        status: 409,
        json: { error: { code: 'DRIVER_PHONE_DUPLICATE', details: { matches: [KARWAN_MATCH] } } },
      });
    }
    return route.fulfill({ status: 201, json: created });
  });
  await page.route(/\/api\/orders$/, (route) => {
    sent.orders.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
  });
  return sent;
}

/** Opens the new-order page with a customer and one line typed, so there is something for the dialog to lose. */
async function startOrder(page: Page): Promise<void> {
  await page.goto('/orders/new');
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: /Kurdistan Cement/ }).click();
  await page.getByRole('radio', { name: 'Lent' }).click();
  await page.locator('#lines-0-item').click();
  await page.getByRole('option', { name: /Pallet A/ }).click();
  await page.locator('#lines-0-quantity').fill('7');
}

async function fillDriver(page: Page, driver: { name: string; phone: string; carNumber: string }): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(driver.name);
  await dialog.getByLabel('Phone').fill(driver.phone);
  await dialog.getByLabel('Car number').fill(driver.carNumber);
}

test('a driver added from the order form is chosen for the order, which keeps what was typed (Q135)', async ({
  page,
}) => {
  const sent = await mockApi(page, ADMIN);
  await startOrder(page);

  await page.getByRole('button', { name: 'New driver' }).click();
  const dialog = page.getByRole('dialog');
  await fillDriver(page, { name: 'Dilshad Omar', phone: '0750 222-3344', carNumber: 'Duhok 21 B 555' });
  // Enter in the dialog saves the driver; it must not reach the order's form underneath.
  await dialog.getByLabel('Car number').press('Enter');

  await expect(dialog).toBeHidden();
  expect(sent.drivers).toEqual([
    { name: 'Dilshad Omar', phone: '07502223344', carNumber: 'Duhok 21 B 555', confirmDuplicatePhone: false },
  ]);
  expect(sent.orders).toEqual([]);
  await expect(page.getByRole('combobox', { name: 'Driver' })).toHaveText(/Dilshad Omar/);
  await expect(page.getByRole('combobox', { name: 'Customer' })).toHaveText(/Kurdistan Cement/);
  await expect(page.locator('#lines-0-quantity')).toHaveValue('7');

  await page.getByRole('button', { name: 'Hand over' }).first().click();
  await expect.poll(() => sent.orders.length).toBe(1);
  expect(sent.orders[0]).toMatchObject({ customerId: 3, driverId: 5, lines: [{ itemId: 1, quantity: 7 }] });
});

test('saving the driver does not submit the order underneath', async ({ page }) => {
  await mockApi(page, ADMIN);
  await page.goto('/orders/new');

  await page.getByRole('button', { name: 'New driver' }).click();
  const dialog = page.getByRole('dialog');
  await fillDriver(page, { name: 'Dilshad Omar', phone: '07502223344', carNumber: 'Duhok 21 B 555' });
  await dialog.getByLabel('Car number').press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Driver' })).toHaveText(/Dilshad Omar/);
  // An order submitted with nothing but a driver would mark its customer and its line as missing.
  await expect(page.locator('main [aria-invalid="true"]')).toHaveCount(0);
});

test('a phone already on file warns while typing, and the driver who has it can be taken instead', async ({ page }) => {
  const sent = await mockApi(page, ADMIN);
  await startOrder(page);

  await page.getByRole('button', { name: 'New driver' }).click();
  const dialog = page.getByRole('dialog');
  await fillDriver(page, { name: 'Karwan A.', phone: '0770 111 2233', carNumber: '22 A 1' });
  await expect(dialog.getByRole('status')).toHaveText(/This number is already used by:\s*Karwan Aziz/);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByRole('heading', { name: 'This phone number is already in use' })).toBeVisible();
  // The name is isolated for bidi, so marks surround it.
  await expect(dialog).toContainText(/It belongs to \W?Karwan Aziz\W?\. Save anyway\?/);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: /^Use \W?Karwan Aziz/ }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Driver' })).toHaveText(/Karwan Aziz/);
  // Only the refused attempt reached the server: no second driver with the number.
  expect(sent.drivers).toHaveLength(1);
});

test('the warning can be backed out of with the typing kept, or answered by saving anyway', async ({ page }) => {
  const twin = { ...DILSHAD, name: 'Karwan’s brother', phone: KARWAN.phone, carNumber: '22 B 2' };
  const sent = await mockApi(page, ADMIN, twin);
  await startOrder(page);

  await page.getByRole('button', { name: 'New driver' }).click();
  const dialog = page.getByRole('dialog');
  await fillDriver(page, { name: 'Karwan’s brother', phone: KARWAN.phone, carNumber: '22 B 2' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'This phone number is already in use' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog.getByRole('heading', { name: 'New driver' })).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue('Karwan’s brother');
  await expect(dialog.getByLabel('Car number')).toHaveValue('22 B 2');

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save anyway' }).click();

  await expect(dialog).toBeHidden();
  expect(sent.drivers.map((body) => body.confirmDuplicatePhone)).toEqual([false, false, true]);
  await expect(page.getByRole('combobox', { name: 'Driver' })).toHaveText(/Karwan’s brother/);
});

test('the phone box of the driver dialog takes no letters, and keeps the caret where the typing is', async ({
  page,
}) => {
  const sent = await mockApi(page, ADMIN);
  await page.goto('/orders/new');
  await page.getByRole('button', { name: 'New driver' }).click();
  const dialog = page.getByRole('dialog');
  const phone = dialog.getByLabel('Phone');

  await phone.pressSequentially('07a50 bcd222-33x44');
  await expect(phone).toHaveValue('0750 222-3344');
  // A letter typed in the middle is dropped where it is; what follows is typed at the same place.
  await phone.evaluate((box: HTMLInputElement) => box.setSelectionRange(4, 4));
  await phone.pressSequentially('q9');
  await expect(phone).toHaveValue('07509 222-3344');
  await phone.fill('Karwan 0750 222 3344');
  await expect(phone).toHaveValue(' 0750 222 3344');

  await dialog.getByLabel('Name').fill('Dilshad Omar');
  await dialog.getByLabel('Car number').fill('Duhok 21 B 555');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.drivers[0]).toMatchObject({ phone: '07502223344' });
});

test('without drivers.create the order form offers no New driver button', async ({ page }) => {
  await mockApi(page, CLERK);
  await page.goto('/orders/new');

  await expect(page.getByRole('combobox', { name: 'Driver' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New driver' })).toHaveCount(0);
});

test('the drivers page warns about a shared phone too, with nobody to take instead', async ({ page }) => {
  const twin = { ...DILSHAD, name: 'Karwan’s brother', phone: KARWAN.phone, carNumber: '22 B 2' };
  const sent = await mockApi(page, ADMIN, twin);
  await page.goto('/drivers');

  await page.getByRole('button', { name: 'New driver' }).first().click();
  const dialog = page.getByRole('dialog');
  await fillDriver(page, { name: 'Karwan’s brother', phone: KARWAN.phone, carNumber: '22 B 2' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByRole('heading', { name: 'This phone number is already in use' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Use / })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save anyway' }).click();

  await expect(dialog).toBeHidden();
  expect(sent.drivers.at(-1)).toMatchObject({ phone: KARWAN.phone, confirmDuplicatePhone: true });
  await expect(page.getByRole('table', { name: 'Drivers' }).getByText('Karwan’s brother')).toBeVisible();
});
