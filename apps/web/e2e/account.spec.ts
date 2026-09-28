import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

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

/** The display name is the user's own to change (Q94); the new name shows in the shell at once. */
test('renames the signed-in user and shows the new name in the shell at once', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/api/auth/me')) sent.push(request.postDataJSON());
  });

  await page.goto('/account');
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await expect(page.getByText('Only an administrator can change your username and role.')).toBeVisible();

  await page.getByLabel('Display name').fill('  Karwan Aziz  ');
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByText('Your name is saved')).toBeVisible();
  expect(sent).toEqual([{ displayName: 'Karwan Aziz', expectedDisplayName: ADMIN.displayName }]);
  await expect(page.getByRole('button', { name: 'Karwan Aziz' }).first()).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Karwan Aziz');
  await expect(save).toBeDisabled();
});

test('an empty display name is refused before it is sent', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/account');

  await page.getByLabel('Display name').fill('   ');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('#displayName-error')).toBeVisible();
});
