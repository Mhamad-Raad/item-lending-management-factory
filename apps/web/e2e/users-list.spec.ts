import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** §7.3.19: the users list filters by role and state, sorts, pages, and becomes cards on a phone. */
test('the users list filters by role and state and sorts by last sign-in', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  const asked: URLSearchParams[] = [];
  page.on('request', (request) => {
    if (/\/api\/users\?/.test(request.url())) asked.push(new URL(request.url()).searchParams);
  });

  await page.goto('/users');
  await expect(page.getByRole('link', { name: 'shilan.employee' })).toBeVisible();
  // Active is said with an icon as well as a colour (§7.15).
  await expect(page.getByRole('cell', { name: 'Active' }).locator('svg')).toBeVisible();

  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Employee' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Inactive' }).click();
  await page.getByRole('button', { name: 'Last sign-in' }).click();

  await expect
    .poll(() =>
      asked.some(
        (params) =>
          params.get('role') === 'EMPLOYEE' &&
          params.get('isActive') === 'false' &&
          params.get('sort') === 'lastLoginAt',
      ),
    )
    .toBe(true);
});

test('on a phone the users list is a list of cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, ADMIN, 'en');

  await page.goto('/users');

  await expect(page.getByRole('list', { name: 'Users' }).getByRole('link', { name: 'shilan.employee' })).toBeVisible();
});
