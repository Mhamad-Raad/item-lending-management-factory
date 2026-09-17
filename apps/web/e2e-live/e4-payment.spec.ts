import { expect, test } from '@playwright/test';
import { adminApi, figure, signIn, sorani, stage, LIVE_ADMIN, RUN } from './live';

/** E4 (§14.6), daily flow 3: a credit order refuses more than is owed, and a valid payment lowers what is owed. */
test('E4: a payment larger than what is owed is refused inline; a valid one updates the order', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const [customer, driver, item] = await Promise.all([
    staged.customer(`بازرگانی شێرکۆ ${RUN}`),
    staged.driver(`هێمن ڕەشید ${RUN}`),
    staged.item(`پالێتی تاقیکردنەوە E4-${RUN}`, 2_000, 50),
  ]);
  const order = await staged.order({
    customerId: customer.id,
    driverId: driver.id,
    paymentType: 'LENT',
    lines: [{ itemId: item.id, quantity: 10 }],
  });

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  await page.goto(`/payments/new?orderId=${order.id}`);
  const amount = page.getByLabel(sorani('payments.fields.amount'), { exact: true });
  await expect(amount).toHaveValue(figure(20_000));
  const summary = page.getByRole('complementary', { name: sorani('payments.new.summary') });

  await amount.fill('20001');
  await summary.getByRole('button', { name: sorani('payments.new.submit') }).click();
  await expect(page.getByRole('alert').filter({ hasText: figure(20_000) })).toBeVisible();
  await expect(page).toHaveURL(/\/payments\/new/);

  await amount.fill('5000');
  await expect(summary.getByText(sorani('payments.new.owedAfter')).locator('..')).toContainText(figure(15_000));
  await summary.getByRole('button', { name: sorani('payments.new.submit') }).click();

  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  const owed = page.getByRole('term').filter({ hasText: new RegExp(`^${sorani('orders.fields.owed')}$`) });
  await expect(owed.locator('xpath=following-sibling::dd[1]')).toContainText(figure(15_000));
  expect((await api.get<{ owed: number }>(`/api/orders/${order.id}`)).owed).toBe(15_000);
});
