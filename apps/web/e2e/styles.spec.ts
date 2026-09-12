import { expect, test } from './fixtures';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** The receipt's print styles belong to the receipt tab alone; the app never inherits its page grey. */
test('an app page does not wear the receipt styles', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user: ADMIN },
    }),
  );
  await page.route(/\/api\/drivers\?/, (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } }),
  );

  await page.goto('/drivers');
  await expect(page.getByRole('heading', { name: 'Drivers' })).toBeVisible();

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe('rgb(229, 229, 229)');
});
