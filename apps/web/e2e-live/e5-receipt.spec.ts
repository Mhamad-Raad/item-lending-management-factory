import { expect, test } from '@playwright/test';
import { adminApi, figure, shown, signIn, sorani, stage, today, LIVE_ADMIN, RUN } from './live';

/**
 * E5 (§14.6): a seven-line order prints on two A4 sheets, each with two copies — six lines on the first, the last
 * line and the total on the second — in Sorani, with Western digits and dd/MM/yyyy.
 */
test('E5: a seven-line receipt prints on exactly two A4 sheets, total on the last', async ({ page, request }) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const [customer, driver] = await Promise.all([
    staged.customer(`کارگەی بلۆکی سۆران ${RUN}`),
    staged.driver(`سۆران جەلال ${RUN}`),
  ]);
  const items = await Promise.all(
    Array.from({ length: 7 }, (_, index) => staged.item(`پالێتی وەسڵ E5-${RUN}-${index + 1}`, 1_000, 20)),
  );
  const order = await staged.order({
    customerId: customer.id,
    driverId: driver.id,
    paymentType: 'LENT',
    lines: items.map((item) => ({ itemId: item.id, quantity: 10 })),
  });

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.goto(`/print/orders/${order.id}`);

  const sheets = page.locator('.sheet');
  await expect(sheets).toHaveCount(2);
  await expect(page.locator('.half')).toHaveCount(4);
  await expect(page.locator('.receipt')).toHaveAttribute('dir', 'rtl');
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  const total = sorani('receipt.depositTotal');
  await expect(sheets.first()).toContainText(sorani('receipt.sheetOf', { x: 1, y: 2 }));
  await expect(sheets.last()).toContainText(sorani('receipt.sheetOf', { x: 2, y: 2 }));
  await expect(sheets.first()).not.toContainText(total);
  await expect(sheets.last()).toContainText(total);
  await expect(sheets.last()).toContainText(figure(70_000));
  await expect(sheets.first()).toContainText(shown(today()));
  await expect(sheets.first()).toContainText(String(order.orderNumber).padStart(6, '0'));
  // Western digits only: no Arabic-Indic or Persian digit anywhere on the printout.
  expect(await page.locator('.receipt').innerText()).not.toMatch(/[٠-٩۰-۹]/);

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(2);
});
