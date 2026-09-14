import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** Q50: appearance lives on /settings for everyone; the factory details below it are an admin's. */
const EMPLOYEE = { ...ADMIN, id: 2, username: 'employee', displayName: 'Employee', role: 'EMPLOYEE' as const };

test('an employee sets the colour theme, typeface and text size, and they survive a reload', async ({ page }) => {
  let settingsCalls = 0;
  await mockApi(page, EMPLOYEE, 'en');
  await page.route(/\/api\/settings$/, (route) => {
    settingsCalls += 1;
    return route.fallback();
  });
  await page.goto('/settings');

  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // The factory details are not the employee's to change, so they are neither shown nor fetched.
  await expect(page.getByText('Factory details')).toHaveCount(0);
  await expect(page.locator('#factoryName')).toHaveCount(0);

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-palette', 'harbor');
  const primaryBefore = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--primary'));

  await page.getByRole('radiogroup', { name: 'Colour theme' }).getByRole('radio', { name: 'Forest' }).check();
  await page.getByRole('radiogroup', { name: 'Typeface' }).getByRole('radio', { name: 'Vazirmatn' }).check();
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Large', exact: true }).check();

  await expect(html).toHaveAttribute('data-palette', 'forest');
  await expect(html).toHaveAttribute('data-font', 'vazirmatn');
  // The theme moves the real colours, and the typeface the family the body is drawn in.
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--primary'))).not.toBe(
    primaryBefore,
  );
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Vazirmatn/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(html).toHaveAttribute('data-palette', 'forest');
  await expect(html).toHaveAttribute('data-font', 'vazirmatn');
  await expect(page.getByRole('radio', { name: 'Forest' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Large', exact: true })).toBeChecked();
  expect(settingsCalls).toBe(0);
});

test('"match the computer" follows the device, also while the page is open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockApi(page, ADMIN, 'en');
  await page.goto('/settings');
  const html = page.locator('html');

  await page.getByRole('radio', { name: 'Match the computer' }).check();
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  // What reads the theme re-renders too: the top bar now offers the light one.
  await expect(page.getByRole('button', { name: 'Switch to light' })).toBeVisible();

  // Before the first paint too: boot-prefs.js resolves it on load.
  await page.reload();
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
});

test('the top bar switches between light and dark in one press', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/');
  const html = page.locator('html');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.getByRole('button', { name: 'Switch to light' }).click();
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
});
