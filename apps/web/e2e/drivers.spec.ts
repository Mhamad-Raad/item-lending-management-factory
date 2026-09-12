import { expect, test, type Page } from '@playwright/test';

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
  expect(created).toEqual({ name: 'Karwan Aziz', phone: '07701112233', carNumber: 'Erbil 12 A 34567' });
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
