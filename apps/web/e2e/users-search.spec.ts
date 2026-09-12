import { expect, test } from '@playwright/test';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/**
 * The search box follows the URL as well as writing to it. If it only wrote, a term the URL no
 * longer carries would push itself back after the debounce, and neither a navigation link nor Back
 * could ever clear the filter.
 */
test('navigating to the unfiltered list clears the search term', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      }),
    }),
  );
  await page.route(/\/api\/users(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 1, pageSize: 25, total: 0 }),
    }),
  );

  await page.goto('/users?q=ali');
  const searchBox = page.getByRole('textbox', { name: 'Search' });
  await expect(searchBox).toHaveValue('ali');

  await page.getByRole('navigation').getByRole('link', { name: 'Users' }).click();

  // Longer than the 300 ms debounce: a stale term would have pushed itself back by now.
  await page.waitForTimeout(800);
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await expect(searchBox).toHaveValue('');
});
