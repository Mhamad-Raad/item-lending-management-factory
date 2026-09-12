import { expect, test, type Page } from './fixtures';
import { mockApi } from './mock-api';

/**
 * §7.15: every screen is usable at 390 px with no horizontal page scroll. Each route renders with
 * long names and large amounts, as an admin (who sees every navigation entry) in Kurdish Sorani.
 * The receipt is left out: printing happens from a desktop, on A4.
 */
const ROUTES = [
  '/',
  '/orders',
  '/orders/new',
  '/orders/9',
  '/orders/9/edit',
  '/customers',
  '/customers/new',
  '/customers/3',
  '/customers/3/edit',
  '/items',
  '/items/new',
  '/items/5',
  '/items/5/edit',
  '/drivers',
  '/history',
  '/users',
  '/users/new',
  '/users/2',
  '/settings',
  '/account',
];

test.use({ viewport: { width: 390, height: 844 } });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
}

for (const path of ROUTES) {
  test(`${path} fits a 390 px screen`, async ({ page }) => {
    await mockApi(page);

    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalScroll(page);
  });
}

test('the sign-in page fits a 390 px screen', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel('ناوی بەکارهێنەر')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
