import { expect, test, type Page } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** May read the history, and nothing else: no users page, no items, no customers. */
const AUDITOR = {
  id: 3,
  username: 'auditor',
  displayName: 'Auditor',
  role: 'EMPLOYEE',
  mustChangePassword: false,
  permissions: ['audit.view'],
};

const ROWS = [
  {
    id: 1,
    createdAt: '2026-09-12T08:00:00.000Z',
    user: { id: 1, username: 'admin', displayName: 'Admin' },
    usernameAttempt: null,
    action: 'UPDATE',
    entityType: 'USER',
    entityId: '2',
    summaryKey: 'audit.summary.USER.UPDATE',
    summaryParams: { username: 'clerk', fields: ['displayName'] },
    before: null,
    after: null,
    ip: '127.0.0.1',
  },
  {
    id: 2,
    createdAt: '2026-09-12T08:05:00.000Z',
    user: { id: 1, username: 'admin', displayName: 'Admin' },
    usernameAttempt: null,
    action: 'CREATE',
    entityType: 'ITEM',
    entityId: '5',
    summaryKey: 'audit.summary.ITEM.CREATE',
    summaryParams: { name: 'Euro pallet', depositPrice: 5000, initialQuantity: 0 },
    before: null,
    after: null,
    ip: '127.0.0.1',
  },
];

async function signIn(page: Page, user: typeof ADMIN | typeof AUDITOR): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user },
    }),
  );
}

/** The history endpoint as the API answers it, keeping every address the page asked for. */
async function mockHistory(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/api\/audit-logs(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const from = url.searchParams.get('dateFrom');
    const to = url.searchParams.get('dateTo');
    if (from && to && from > to) {
      return route.fulfill({ status: 400, json: { error: { code: 'DATE_RANGE_INVALID', details: {} } } });
    }
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    return route.fulfill({ json: { items: ROWS, page: pageNumber, pageSize: 50, total: 200 } });
  });
  return asked;
}

test('a reversed date range is reported next to the dates, and the filters stay', async ({ page }) => {
  await signIn(page, ADMIN);
  const asked = await mockHistory(page);

  await page.goto('/history?dateFrom=2026-09-10&dateTo=2026-09-01');

  await expect(page.getByLabel('From')).toHaveValue('10/09/2026');
  await expect(page.getByRole('alert').filter({ hasText: 'The start date is after the end date' })).toBeVisible();
  expect(asked.filter((search) => search.includes('dateFrom=2026-09-10'))).toEqual([]);
});

test('passing through a date box without changing it keeps the page', async ({ page }) => {
  await signIn(page, ADMIN);
  await mockHistory(page);

  await page.goto('/history?page=3');
  await expect(page.getByRole('table').getByRole('link', { name: '#2' })).toBeVisible();
  await page.getByLabel('From').click();
  await page.getByRole('heading', { name: 'History' }).click();

  await page.waitForTimeout(300);
  expect(new URL(page.url()).searchParams.get('page')).toBe('3');
});

test('a record links to its page only for a viewer who may open it', async ({ page }) => {
  await signIn(page, AUDITOR);
  await mockHistory(page);

  await page.goto('/history');

  const table = page.getByRole('table');
  await expect(table.getByText('#2')).toBeVisible();
  await expect(table.getByRole('link', { name: '#2' })).toHaveCount(0);
  await expect(table.getByRole('link', { name: '#5' })).toHaveCount(0);
});

test('on a phone, a reversed date range is reported without opening the filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN);
  await mockHistory(page);

  await page.goto('/history?dateFrom=2026-09-10&dateTo=2026-09-01');

  await expect(page.getByRole('alert').filter({ hasText: 'The start date is after the end date' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filters' })).toContainText('1');
});
