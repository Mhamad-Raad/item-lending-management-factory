import { formatOrderNumber } from '@pallet/shared';
import { expect, test } from '@playwright/test';
import { adminApi, figure, signIn, sorani, soraniPattern, stage, LIVE_ADMIN, RUN } from './live';

/**
 * E3 (§14.6), daily flow 2 from the dashboard's quick action, from the customer (Q156): their pallets out by order,
 * the refund due, the cash refund and what is owed afterwards follow the quantities as they are typed, the cash paid
 * out opens the dialog with its receipt, and the order shows what came back.
 */
test('E3: a return recorded from the dashboard pays out what exceeds the debt and shows on its order', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const staged = stage(api);
  const [customer, driver, item] = await Promise.all([
    staged.customer(`کۆمپانیای گواستنەوەی نەوزاد ${RUN}`),
    staged.driver(`کاروان ئەحمەد ${RUN}`),
    staged.item(`پالێتی تاقیکردنەوە E3-${RUN}`, 2_000, 100),
  ]);
  // 40 lent at 2,000 = 80,000, of which 50,000 is paid: 30,000 owed, 40 out.
  const order = await staged.order({
    customerId: customer.id,
    driverId: driver.id,
    paymentType: 'LENT',
    lines: [{ itemId: item.id, quantity: 40 }],
  });
  await staged.payment(order.id, 50_000);

  await signIn(page, LIVE_ADMIN.username, LIVE_ADMIN.password);
  await page
    .getByRole('region', { name: sorani('dashboard.quick.title') })
    .getByRole('link', { name: sorani('returns.new.title') })
    .click();
  await expect(page).toHaveURL(/\/returns\/new/);

  await page.getByRole('combobox', { name: sorani('orders.fields.customer') }).click();
  await page.keyboard.type(RUN);
  await page.getByRole('option', { name: new RegExp(customer.name) }).click();
  // Everything the customer holds, by order: here one order, its number opening it.
  await expect(page).toHaveURL(new RegExp(`customerId=${customer.id}`));
  await expect(page.getByRole('link', { name: formatOrderNumber(order.orderNumber) }).first()).toHaveAttribute(
    'href',
    `/orders/${order.id}`,
  );

  const line = page.getByRole('listitem').filter({ hasText: item.name });
  await expect(line).toContainText('40');
  const summary = page.getByRole('complementary', { name: sorani('returns.new.summary') });
  const figureOf = (key: string) => summary.getByText(sorani(key), { exact: true }).locator('..');

  const accepted = line.getByLabel(sorani('returns.fields.accepted'), { exact: true });
  await accepted.fill('');
  await accepted.pressSequentially('1');
  await expect(figureOf('returns.new.refundDue')).toContainText(figure(2_000));
  // Within the debt nothing is paid out, and the cash-refund line stays out of the way.
  await expect(summary.getByText(sorani('returns.new.cashRefund'), { exact: true })).toHaveCount(0);
  await expect(figureOf('returns.new.owedAfter')).toContainText(figure(28_000));
  await accepted.fill('30');
  await expect(figureOf('returns.new.refundDue')).toContainText(figure(60_000));
  await expect(figureOf('returns.new.owedBefore')).toContainText(figure(30_000));
  // Past the debt the difference is paid out, and the clerk is told to hand it over now.
  await expect(summary).toContainText(soraniPattern('returns.new.cashHandover', { amount: figure(30_000) }));
  await expect(figureOf('returns.new.owedAfter')).toContainText('0');
  await expect(figureOf('returns.new.outAfter')).toContainText('10');

  await summary.getByRole('button', { name: sorani('returns.new.submit') }).click();
  // Cash went out: the dialog offers its receipt; closed, the flow goes on to the one order it was recorded on.
  const saved = page.getByRole('dialog');
  await expect(saved).toContainText(figure(30_000));
  await expect(saved.getByRole('button', { name: sorani('orders.money.printReceipt') })).toBeVisible();
  await saved
    .getByRole('button', { name: sorani('common.actions.close') })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  // Item, quantity, deposit each, line total, returned, damaged, still out.
  const row = page.getByRole('row', { name: new RegExp(item.name) }).first();
  await expect(row.getByRole('cell').nth(4)).toHaveText('30');
  await expect(row.getByRole('cell').nth(6)).toHaveText('10');
  const stored = await api.get<{ owed: number; outQuantityTotal: number; refundsNet: number }>(
    `/api/orders/${order.id}`,
  );
  expect(stored).toMatchObject({ owed: 0, outQuantityTotal: 10, refundsNet: 30_000 });
});
