import { expect, test, type Page } from '@playwright/test';

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
  await expect(dialog).toContainText('It belongs to Old Blocks');
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
