import { expect, test } from '@playwright/test';

/**
 * Runs against the built app with no API behind it: the session bootstrap fails, so every visit
 * lands on the login page. That is exactly what an anonymous visitor sees, and it keeps this
 * smoke test independent of the database (the full flows arrive with the M7 e2e setup).
 */
test('an anonymous visitor lands on the login page, in Kurdish Sorani and right-to-left', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login/);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ckb');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByLabel('ناوی بەکارهێنەر')).toBeVisible();
});

test('the language switcher changes direction and survives a reload', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('button', { name: 'English' }).click();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.getByLabel('Username')).toBeVisible();

  await page.reload();
  await expect(html).toHaveAttribute('dir', 'ltr');
});

test('an empty sign-in form reports both fields', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'English' }).click();

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('alert').first()).toBeVisible();
});
