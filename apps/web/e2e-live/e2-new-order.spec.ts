import { expect, test } from '@playwright/test';
import { adminApi, figure, signIn, sorani, stage, LIVE_ADMIN, RUN } from './live';

/** E2 (§14.6), daily flow 1 in Sorani: searchable pickers, a live deposit total, the order and its stock. */
test('E2: an order handed over in Sorani lands on its page and takes its pallets out of stock', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const customer = await staged.customer(`کۆمپانیای بینای دیلان ${RUN}`);
  const driver = await staged.driver(`ئاراس محەمەد ${RUN}`);
  const item = await staged.item(`پالێتی تاقیکردنەوە E2-${RUN}`, 2_000, 100);

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  await page.goto('/orders/new');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Each picker searches as the clerk types: this run's tag narrows each list to the one record staged for it.
  const pick = async (field: string, name: string) => {
    await page.getByRole('combobox', { name: field }).click();
    await page.keyboard.type(RUN);
    await expect(page.getByRole('option', { name: new RegExp(name) })).toHaveCount(1);
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: new RegExp(name) }).click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  };
  await pick(sorani('orders.fields.customer'), customer.name);
  await expect(page.getByRole('combobox', { name: sorani('orders.fields.customer') })).toContainText(customer.name);
  await pick(sorani('orders.fields.driver'), driver.name);

  await page.getByRole('radio', { name: sorani('orders.new.lent') }).click();
  await page.locator('#lines-0-item').click();
  await page.keyboard.type(RUN);
  await expect(page.getByRole('option', { name: new RegExp(item.name) })).toHaveCount(1);
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('option', { name: new RegExp(item.name) }).click();

  const summary = page.getByRole('complementary', { name: sorani('orders.new.summary.title') });
  const quantity = page.locator('#lines-0-quantity');
  await quantity.pressSequentially('7');
  await expect(summary).toContainText(figure(14_000));
  await quantity.pressSequentially('2');
  await expect(summary).toContainText(figure(144_000));
  await quantity.fill('12');
  await expect(summary).toContainText(figure(24_000));

  await summary.getByRole('button', { name: sorani('orders.new.submit') }).click();
  await expect(page).toHaveURL(/\/orders\/\d+\?created=true$/);
  const orderId = Number(/\/orders\/(\d+)/.exec(page.url())?.[1]);
  const order = await api.get<{ orderNumber: number }>(`/api/orders/${orderId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`#${String(order.orderNumber).padStart(6, '0')}`);

  await page.goto(`/items/${item.id}`);
  const onHand = page.getByRole('term').filter({ hasText: sorani('items.fields.quantityOnHand') });
  await expect(onHand.locator('xpath=following-sibling::dd[1]')).toHaveText('88');
});
