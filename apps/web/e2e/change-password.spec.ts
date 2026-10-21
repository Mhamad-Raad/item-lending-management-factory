import type { AuthTokenDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/**
 * Q159: the change-password page is only for a user who must set a password. A phone reopens on the last page, and a
 * bookmark or home-screen shortcut keeps the address it was made on — often this page, right after a first sign-in —
 * so it must not ask again a user who already has.
 */
const dashboard = (page: Page) => page.getByRole('heading', { name: 'Dashboard', level: 1 });
const changeButton = (page: Page) => page.getByRole('button', { name: 'Change password' });

test('a user who must set a password is held on the page, wherever they go', async ({ page }) => {
  await mockApi(page, { ...ADMIN, mustChangePassword: true }, 'en');

  await page.goto('/orders');

  await expect(page).toHaveURL(/\/change-password$/);
  await expect(changeButton(page)).toBeVisible();
});

test('a user who has set a password, reopening the page’s address, lands on the dashboard', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');

  await page.goto('/change-password');

  await expect(page).toHaveURL(/\/$/);
  await expect(dashboard(page)).toBeVisible();
  await expect(changeButton(page)).toHaveCount(0);
});

test('signing in again from the page’s address, after a session ended, lands on the dashboard', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  // The session ended: no cookie to refresh, so the app starts signed out.
  await page.route(/\/api\/auth\/refresh$/, (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } }),
  );
  await page.route(/\/api\/auth\/login$/, (route) =>
    route.fulfill({
      json: {
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      } satisfies AuthTokenDto,
    }),
  );

  await page.goto('/change-password');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fchange-password$/);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('whatever-it-is');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(dashboard(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('set in another tab meanwhile, the page leaves for the dashboard at its next session refresh', async ({
  page,
}) => {
  await mockApi(page, { ...ADMIN, mustChangePassword: true }, 'en');
  // The first refresh restores the session with the flag set and a token close to its end; the next — the one the
  // page makes on its own 10 s later — finds the password set in another tab.
  let refreshes = 0;
  await page.route(/\/api\/auth\/refresh$/, (route) => {
    refreshes += 1;
    return route.fulfill({
      json: {
        accessToken: `token-${refreshes}`,
        accessTokenExpiresAt: new Date(Date.now() + (refreshes === 1 ? 30_000 : 900_000)).toISOString(),
        user: refreshes === 1 ? { ...ADMIN, mustChangePassword: true } : ADMIN,
      } satisfies AuthTokenDto,
    });
  });
  await page.goto('/change-password');
  await expect(changeButton(page)).toBeVisible();

  await expect(dashboard(page)).toBeVisible({ timeout: 20_000 });
  expect(refreshes).toBeGreaterThan(1);
  await expect(page).toHaveURL(/\/$/);
});

test('a changed password goes on to the dashboard once, and Back does not return to the form', async ({ page }) => {
  await mockApi(page, { ...ADMIN, mustChangePassword: true }, 'en');
  await page.route(/\/api\/auth\/change-password$/, (route) =>
    route.fulfill({
      json: {
        accessToken: 'token-2',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: ADMIN,
      } satisfies AuthTokenDto,
    }),
  );
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel('Current password').fill('the-one-the-admin-set');
  await page.getByLabel('New password', { exact: true }).fill('a-new-and-long-password');
  await page.getByLabel('Confirm new password').fill('a-new-and-long-password');
  await changeButton(page).click();

  await expect(dashboard(page)).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/\/change-password$/);
});
