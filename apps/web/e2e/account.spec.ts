import { expect, test } from './fixtures';
import { mockApi } from './mock-api';

/**
 * "Log out everywhere" signs this device out even when the request fails (Q76): the user asked to leave,
 * and is told the other sessions may still be open.
 */
test('log out everywhere signs this device out even when the request fails, and says so', async ({ page }) => {
  await mockApi(page, undefined, 'en');
  await page.route('**/api/auth/logout-all', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' }, requestId: 'r-1' } }),
  );

  await page.goto('/account');
  await page.getByRole('button', { name: 'Log out everywhere' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log out everywhere' }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText('You are signed out on this device, but the other sessions could not be ended.'),
  ).toBeVisible();
});
