import { expect, test } from '@playwright/test';
import { adminApi, signIn, sorani } from './live';

/** E1 (§14.6): a new user is sent to change the password first, then lands on the dashboard. */
test('E1: a new employee changes the password on first sign-in, then reaches the dashboard', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const first = 'Kurdistan-Pallets-2026!';
  const chosen = 'Erbil-Yard-Gate-2026!';
  const username = `e1clerk${Date.now().toString(36)}`;
  await api.createEmployee(username, first, ['orders.view']);

  await signIn(page, username, first);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByText(sorani('auth.changePassword.description'), { exact: true })).toBeVisible();
  // Every other page sends a user who must change the password back here.
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel(sorani('auth.changePassword.current'), { exact: true }).fill(first);
  await page.getByLabel(sorani('auth.changePassword.new'), { exact: true }).fill(chosen);
  await page.getByLabel(sorani('auth.changePassword.confirm'), { exact: true }).fill(chosen);
  await page.getByRole('button', { name: sorani('auth.changePassword.submit'), exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: sorani('dashboard.title') })).toBeVisible();
  // The new password is the one that works from now on.
  await page.context().clearCookies();
  await signIn(page, username, chosen);
  await expect(page).toHaveURL(/\/$/);
});
