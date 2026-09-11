import { expect, test } from '@playwright/test';

test('boots in Kurdish Sorani, right-to-left, and switches to English left-to-right', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ckb');
  await expect(html).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'English' }).click();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');

  // Preference survives a reload (localStorage).
  await page.reload();
  await expect(html).toHaveAttribute('dir', 'ltr');
});
