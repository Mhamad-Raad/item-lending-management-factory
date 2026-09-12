import { expect, test, type Page } from '@playwright/test';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** Reads items and their purchases, but may not see what a purchase cost. */
const CLERK = {
  id: 2,
  username: 'clerk',
  displayName: 'Clerk',
  role: 'EMPLOYEE',
  mustChangePassword: false,
  permissions: ['items.view', 'purchases.view'],
};

const ITEM = {
  id: 5,
  name: 'Euro pallet',
  imageUploadId: null,
  imageUrl: null,
  depositPrice: 5_000,
  quantityOnHand: 50,
  minStock: null,
  isLowStock: false,
  quantityOut: 0,
  damagedTotal: 0,
  archivedAt: null,
  version: 1,
  createdAt: '2026-09-12T08:00:00.000Z',
  updatedAt: '2026-09-12T08:00:00.000Z',
};

const page1 = <T>(items: T[]) => ({ items, page: 1, pageSize: 25, total: items.length });

async function signIn(
  page: Page,
  user: typeof ADMIN | typeof CLERK,
  expiresAt = new Date(Date.now() + 900_000),
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: expiresAt.toISOString(), user },
    }),
  );
}

/** Today in Baghdad, as the form's date defaults to it. */
function baghdadToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
}

test('an item created with initial stock opens on its own page, with that stock on hand', async ({ page }) => {
  await signIn(page, ADMIN);
  let created: unknown;
  await page.route(/\/api\/items$/, (route) => {
    created = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: ITEM });
  });
  await page.route(/\/api\/items\/5$/, (route) => route.fulfill({ json: ITEM }));
  await page.route(/\/api\/items\/5\/stock-movements/, (route) => route.fulfill({ json: page1([]) }));

  await page.goto('/items/new');
  await page.getByLabel('Name').fill('Euro pallet');
  // Typed on an Arabic keyboard: read as 5000 and shown with a separator.
  await page.getByLabel('Deposit price').fill('٥٠٠٠');
  await expect(page.getByLabel('Deposit price')).toHaveValue('5,000');
  await page.getByLabel('Add initial stock').click();
  await page.getByLabel('Quantity').fill('50');
  await page.getByLabel('Unit cost').fill('700');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Euro pallet' })).toBeVisible();
  expect(created).toEqual({
    name: 'Euro pallet',
    depositPrice: 5_000,
    minStock: null,
    imageUploadId: null,
    initialBatch: { date: baghdadToday(), quantity: 50, unitCost: 700, note: null },
  });
  await expect(page.getByText('On hand').locator('..')).toContainText('50');
});

test('a viewer without items.viewCost sees purchases without any cost', async ({ page }) => {
  await signIn(page, CLERK);
  await page.route(/\/api\/items\/5$/, (route) => route.fulfill({ json: ITEM }));
  await page.route(/\/api\/items\/5\/stock-movements/, (route) => route.fulfill({ json: page1([]) }));
  // The server leaves cost out for this viewer; the page must not invent columns for it.
  await page.route(/\/api\/purchase-batches\?/, (route) =>
    route.fulfill({
      json: page1([
        {
          id: 9,
          itemId: 5,
          itemName: 'Euro pallet',
          date: '2026-09-10',
          quantity: 50,
          note: null,
          version: 1,
          createdAt: '2026-09-10T08:00:00.000Z',
          updatedAt: '2026-09-10T08:00:00.000Z',
          createdBy: { id: 1, username: 'admin', displayName: 'Admin' },
        },
      ]),
    }),
  );

  await page.goto('/items/5?tab=batches');

  await expect(page.getByRole('columnheader', { name: 'Quantity' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Unit cost' })).toHaveCount(0);
  await expect(page.getByText('Total cost')).toHaveCount(0);
  // Nor any action the viewer may not take.
  await expect(page.getByRole('button', { name: 'Add purchase' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjust stock' })).toHaveCount(0);
});

test('the item list fits a phone screen, as cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN);
  await page.route(/\/api\/items(\?.*)?$/, (route) => route.fulfill({ json: page1([ITEM]) }));

  await page.goto('/items');

  await expect(page.getByRole('list', { name: 'Items' }).getByText('Euro pallet')).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});

test('the purchase dialog offers today, even on a page opened yesterday', async ({ page }) => {
  // 23:58 in Baghdad; the token outlives the night on the page's own clock.
  await page.clock.install({ time: new Date('2026-09-12T20:58:00Z') });
  await signIn(page, ADMIN, new Date('2026-09-13T12:00:00Z'));
  await page.route(/\/api\/items\/5$/, (route) => route.fulfill({ json: ITEM }));
  await page.route(/\/api\/items\/5\/stock-movements/, (route) => route.fulfill({ json: page1([]) }));

  await page.goto('/items/5');
  await expect(page.getByRole('heading', { name: 'Euro pallet' })).toBeVisible();
  await page.clock.fastForward('05:00');
  await page.getByRole('button', { name: 'Add purchase' }).click();

  await expect(page.getByRole('dialog').getByLabel('Date')).toHaveValue('13/09/2026');
});

test('the first batch of a new item is dated today, even on a form opened yesterday', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-12T20:58:00Z') });
  await signIn(page, ADMIN, new Date('2026-09-13T12:00:00Z'));

  await page.goto('/items/new');
  await expect(page.getByLabel('Name')).toBeVisible();
  await page.clock.fastForward('05:00');
  await page.getByLabel('Add initial stock').click();

  await expect(page.getByLabel('Date')).toHaveValue('13/09/2026');
});

test('a search longer than the API accepts is cut to its limit, and the list stays usable', async ({ page }) => {
  await signIn(page, ADMIN);
  const asked: string[] = [];
  await page.route(/\/api\/items(\?.*)?$/, (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    asked.push(q);
    return q.length > 100
      ? route.fulfill({
          status: 400,
          json: { error: { code: 'VALIDATION_FAILED', fields: [{ path: 'q', code: 'too_long' }] } },
        })
      : route.fulfill({ json: page1([]) });
  });

  await page.goto(`/items?q=${'x'.repeat(101)}`);

  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();
  expect(asked.every((q) => q.length <= 100)).toBe(true);
});

test("a purchase in the stock ledger links to the item's purchases, and items sort by when they were added", async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.route(/\/api\/items\/5$/, (route) => route.fulfill({ json: ITEM }));
  await page.route(/\/api\/items\/5\/stock-movements/, (route) =>
    route.fulfill({
      json: page1([
        {
          id: 1,
          itemId: 5,
          quantity: 50,
          reason: 'BATCH_ADD',
          batchId: 9,
          orderId: null,
          orderNumber: null,
          returnId: null,
          note: null,
          balanceAfter: 50,
          createdAt: '2026-09-12T08:00:00.000Z',
          createdBy: { id: 1, username: 'admin', displayName: 'Admin' },
        },
      ]),
    }),
  );
  await page.route(/\/api\/items(\?.*)?$/, (route) => route.fulfill({ json: page1([ITEM]) }));

  await page.goto('/items/5');
  await expect(page.getByRole('link', { name: 'Purchase #9' })).toHaveAttribute('href', /tab=batches/);

  await page.goto('/items');
  await page.getByRole('button', { name: 'Added' }).click();
  await expect(page).toHaveURL(/sort=createdAt/);
});
