import { expect, test } from '@playwright/test';
import { adminApi, figure, shown, signIn, sorani, stage, today, LIVE_ADMIN, RUN } from './live';

/**
 * E5 (§14.6): a seven-line order is more than a half holds, so each copy — the factory's and the customer's —
 * prints on an A4 page of its own, all seven lines and the total on each (Q150), in Sorani, with Western digits and
 * dd/MM/yyyy. A return recorded afterwards is on the reprint (Q134).
 */
test('E5: a seven-line receipt prints each copy on an A4 page of its own, with the total', async ({
  page,
  request,
}) => {
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
      const state = window as unknown as { printed: number; rowAtPrint: string };
      state.printed += 1;
      state.rowAtPrint = document.querySelector('.page tbody tr')?.textContent ?? '';
    };
  });
  await page.goto(`/print/orders/${order.id}`);

  const sheets = page.locator('.sheet');
  await expect(sheets).toHaveCount(2);
  await expect(page.locator('.page')).toHaveCount(2);
  await expect(page.locator('.receipt')).toHaveAttribute('dir', 'rtl');
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  const total = sorani('receipt.depositTotal');
  for (const sheet of await sheets.all()) {
    await expect(sheet).toContainText(sorani('receipt.sheetOf', { x: 1, y: 1 }));
    await expect(sheet).toContainText(total);
    await expect(sheet).toContainText(figure(70_000));
  }
  await expect(sheets.first()).toContainText(shown(today()));
  await expect(sheets.first()).toContainText(String(order.orderNumber).padStart(6, '0'));
  // Western digits only: no Arabic-Indic or Persian digit anywhere on the printout.
  expect(await page.locator('.receipt').innerText()).not.toMatch(/[٠-٩۰-۹]/);

  // Q134: a return recorded while this tab stays open; its Print button reads the order again before printing.
  const [firstLine] = order.lines;
  if (!firstLine) throw new Error('the order has lines');
  const firstRow = sheets.first().locator('.page tbody tr').first().locator('td');
  await expect(firstRow).toHaveText(['1', items[0]?.name ?? '', '10', '0', '0', '10', figure(1_000), figure(10_000)]);
  await staged.return(order.id, [{ orderLineId: firstLine.id, acceptedQuantity: 6, damagedQuantity: 1 }]);
  await page.getByRole('button', { name: sorani('receipt.print') }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(2);
  // What was on the page when the printer was called, not what a later look finds there.
  expect(await page.evaluate(() => (window as unknown as { rowAtPrint: string }).rowAtPrint)).toContain(
    ['10', '6', '1', '3', figure(1_000)].join(''),
  );
  await expect(firstRow).toHaveText(['1', items[0]?.name ?? '', '10', '6', '1', '3', figure(1_000), figure(10_000)]);
  await expect(sheets.first()).toContainText(`${sorani('receipt.printedOn')}: ${shown(today())}`);

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(2);
});
