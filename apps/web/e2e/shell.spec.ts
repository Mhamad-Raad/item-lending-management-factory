import { expect, test } from './fixtures';

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

test('a locked sign-in says to wait, and for how long (Q93)', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: 'LOGIN_THROTTLED', details: { retryAfterSeconds: 480, retryAfterMinutes: 8 } } },
    }),
  );
  await page.goto('/login');

  await page.getByLabel('ناوی بەکارهێنەر').fill('karwan');
  await page.getByLabel('وشەی تێپەڕ', { exact: true }).fill('whatever-it-is');
  await page.getByRole('button', { name: 'چوونەژوورەوە', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'وشەی تێپەڕ چەند جارێک بە هەڵە نووسرا. چاوەڕێ بکە، پاشان دووبارە هەوڵ بدەوە. ماوەی چاوەڕوانی (خولەک): 8',
  );
});
