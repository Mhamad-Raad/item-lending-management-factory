import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** A failed read is retried twice with backoff before it shows (lib/query-client.ts), so its state takes a few seconds. */
const AFTER_RETRIES = { timeout: 15_000 };

const SERVER_ERROR = { status: 500, json: { error: { code: 'INTERNAL_ERROR' }, requestId: 'req-42' } };

test('a search that fails says so and offers a retry, instead of "nothing found"', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  let failing = true;
  await page.route(/\/api\/drivers\?/, (route) => (failing ? route.fulfill(SERVER_ERROR) : route.fallback()));
  await page.goto('/orders/new');
  await page.getByRole('combobox', { name: 'Driver' }).click();

  await expect(page.getByText('The search failed.')).toBeVisible(AFTER_RETRIES);
  await expect(page.getByText('Nothing found')).toHaveCount(0);
  // A listbox holds options only: the message and its button sit outside it, and no stale result shows under it.
  await expect(page.getByRole('listbox').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('option')).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('option').first()).toBeVisible();
});

test('the new order says when the credit limit could not be checked', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/customers\/\d+$/, (route) => route.fulfill(SERVER_ERROR));
  await page.goto('/orders/new');
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option').first().click();

  await expect(page.getByText("The customer's credit limit could not be checked here")).toBeVisible(AFTER_RETRIES);
});

test('the receipt says it is loading while it loads', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/orders\/\d+\/receipt$/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/print/orders/9');

  await expect(page.getByRole('status')).toContainText('Loading…');
  release();
  await expect(page.locator('.sheet')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a page that fails to load shows its reference unscrambled, even in Kurdish', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  const reference = '12345678-abcd-4ef0-9a1b-2c3d4e5f6a7b';
  await page.route(/\/api\/drivers\?/, (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' }, requestId: reference } }),
  );
  await page.goto('/drivers');

  const alert = page.getByRole('alert').filter({ hasText: reference });
  await expect(alert).toBeVisible(AFTER_RETRIES);
  expect(await alert.textContent()).toContain(`\u2068${reference}\u2069`);
});

test('an old or hand-edited link with values a list does not know opens that list with its defaults', async ({
  page,
}) => {
  await mockApi(page, ADMIN, 'en');
  const broken: string[] = [];
  for (const route of [
    '/orders?page=abc&status=FOO&sort=nope',
    '/customers?page=0&pageSize=7&sort=nope',
    '/items?page=-1&lowStockOnly=maybe',
    '/drivers?pageSize=huge',
    '/users?role=OWNER&isActive=perhaps',
    '/history?action=FOO&entityType=BAR&page=abc&userId=x',
  ]) {
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    const heading = await page.locator('main h1').first().textContent();
    if (heading?.includes('Something went wrong')) broken.push(route);
  }
  expect(broken).toEqual([]);
});
