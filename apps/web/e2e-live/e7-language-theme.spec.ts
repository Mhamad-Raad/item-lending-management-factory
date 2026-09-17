import { expect, test, type Page } from '@playwright/test';
import { adminApi, signIn, stage, LIVE_ADMIN, RUN } from './live';

const receiptColours = async (page: Page, orderId: number) => {
  await page.goto(`/print/orders/${orderId}`);
  await expect(page.locator('.sheet').first()).toBeVisible();
  return page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      background: body.backgroundColor,
      text: body.color,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      dark: document.documentElement.classList.contains('dark'),
    };
  });
};

/** E7 (§14.6): language and theme change the running page; the receipt ignores the theme. */
test('E7: English flips the direction without a reload, dark sets html.dark, and the receipt stays light', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const [customer, driver, item] = await Promise.all([
    staged.customer(`کۆمپانیای ڕووناکی ${RUN}`),
    staged.driver(`ڕێباز کەریم ${RUN}`),
    staged.item(`پالێتی تاقیکردنەوە E7-${RUN}`, 1_000, 10),
  ]);
  const order = await staged.order({
    customerId: customer.id,
    driverId: driver.id,
    paymentType: 'LENT',
    lines: [{ itemId: item.id, quantity: 2 }],
  });
  await page.addInitScript(() => {
    window.print = () => undefined;
  });

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  const light = await receiptColours(page, order.id);

  await page.goto('/settings');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'rtl');
  // A reload would wipe this marker.
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
  await page.getByRole('button', { name: 'English' }).click();
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(html).toHaveAttribute('lang', 'en');
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);

  const dark = await receiptColours(page, order.id);
  expect(dark).toEqual({ ...light, dark: false, scheme: 'light' });
});
