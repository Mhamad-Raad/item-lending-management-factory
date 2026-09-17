import { expect, test } from '@playwright/test';
import { LIVE_ADMIN, sorani, signIn } from './live';

test('the admin signs in to the seeded factory, in Sorani and right to left', async ({ page }) => {
  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/orders?status=ALL');
  // The demo seed records ten orders; the list shows them from the real API.
  await expect(page.getByRole('link', { name: /^#0000\d\d$/ }).first()).toBeVisible();
  await expect(page.getByText(sorani('orders.list.new')).first()).toBeVisible();
});
