import { expect, test } from './fixtures';

/**
 * A guard that throws in a child route stores the error on that child's match, so the message the
 * user sees comes from the router's default error component. Before that was wired up, this page
 * rendered the raw word FORBIDDEN.
 */
test('a page the user may not open shows the translated forbidden message', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  // A signed-in employee with no permissions, as the session bootstrap would leave the store.
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'token',
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: {
          id: 2,
          username: 'employee',
          displayName: 'Employee',
          role: 'EMPLOYEE',
          mustChangePassword: false,
          permissions: [],
        },
      }),
    }),
  );

  await page.goto('/history');

  await expect(page.getByRole('heading', { name: 'You do not have permission to open this page' })).toBeVisible();
  await expect(page.getByText('FORBIDDEN')).toHaveCount(0);
});
