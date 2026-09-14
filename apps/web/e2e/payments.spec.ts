import type { OrderDetailDto, OrderListItemDto, PaymentResultDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, CUSTOMER, ORDER, mockApi } from './mock-api';

/** §4.10 E5: a credit order of 100,000 with 40,000 paid and every pallet still out. */
const OWING: OrderDetailDto = {
  ...ORDER,
  depositTotal: 100_000,
  paymentsNet: 40_000,
  owed: 60_000,
  outValue: 100_000,
  held: 40_000,
  outQuantityTotal: 100,
};
const SETTLING: OrderDetailDto = { ...OWING, owed: 20_000, outQuantityTotal: 0, outValue: 0, held: 0 };

async function mockPayments(
  page: Page,
  order: OrderDetailDto = OWING,
): Promise<{ sent: { body: unknown; key?: string }[] }> {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: order }));
  const sent: { body: unknown; key?: string }[] = [];
  await page.route(/\/api\/orders\/9\/payments$/, (route) => {
    sent.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    const result: PaymentResultDto = { ledgerEntryId: 77, order: { ...order, owed: 0 } };
    return route.fulfill({ status: 201, json: result });
  });
  return { sent };
}

test('daily flow 3: the full amount is ready, half is one tap, and the payment lands on its order', async ({
  page,
}) => {
  const { sent } = await mockPayments(page);

  await page.goto('/payments/new?orderId=9');

  const amount = page.getByLabel('Amount');
  await expect(amount).toHaveValue('60,000');
  await expect(amount).toBeFocused();
  const summary = page.getByRole('complementary', { name: 'Summary' });
  await expect(summary).toContainText('60,000');

  await page.getByRole('button', { name: 'Half' }).click();
  await expect(amount).toHaveValue('30,000');
  await expect(summary.getByText('Owed after').locator('..')).toContainText('30,000');

  await page.getByLabel('Note').fill('Paid at the gate');
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Record payment' }).click();

  await expect(page).toHaveURL(/\/orders\/9$/);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({
    amount: 30_000,
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    note: 'Paid at the gate',
  });
  expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
});

test('says when a payment will settle the order, and refuses more than is owed', async ({ page }) => {
  await mockPayments(page, SETTLING);

  await page.goto('/payments/new?orderId=9');
  const summary = page.getByRole('complementary', { name: 'Summary' });
  await expect(summary).toContainText('This order will be settled');

  await page.getByLabel('Amount').fill('20001');
  await summary.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '20,000' })).toBeVisible();
});

test('a payment the server finds too large keeps what was typed and says what is owed now', async ({ page }) => {
  await mockPayments(page);
  let refused = false;
  // Someone paid meanwhile: the reloaded order has moved on a version and owes less.
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({ json: refused ? { ...OWING, owed: 10_000, version: OWING.version + 1 } : OWING }),
  );
  await page.route(/\/api\/orders\/9\/payments$/, (route) => {
    refused = true;
    return route.fulfill({
      status: 409,
      json: { error: { code: 'PAYMENT_EXCEEDS_OWED', details: { owed: 10_000, amount: 50_000 } } },
    });
  });

  await page.goto('/payments/new?orderId=9');
  await page.getByLabel('Amount').fill('50000');
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Record payment' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '10,000' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Summary' })).toContainText('10,000');
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert').filter({ hasText: '10,000' })).toBeVisible();
  await expect(page.getByLabel('Amount')).toHaveValue('50,000');
  await expect(page).toHaveURL(/\/payments\/new/);
});

test('without an order, the customer is picked first and their only order owing is chosen for them', async ({
  page,
}) => {
  await mockPayments(page);
  const asked: URLSearchParams[] = [];
  const row: OrderListItemDto = { ...OWING };
  await page.route(/\/api\/orders\?/, (route) => {
    asked.push(new URL(route.request().url()).searchParams);
    return route.fulfill({
      json: { items: [row, { ...row, id: 10, orderNumber: 43, owed: 0 }], page: 1, pageSize: 100, total: 2 },
    });
  });

  await page.goto('/payments/new');
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: new RegExp(CUSTOMER.name.slice(0, 20)) }).click();

  await expect(page).toHaveURL(/orderId=9/);
  await expect(page.getByLabel('Amount')).toHaveValue('60,000');
  expect(
    asked.some(
      (params) =>
        params.get('status') === 'OPEN' &&
        params.get('paymentType') === 'LENT' &&
        params.get('customerId') === String(CUSTOMER.id),
    ),
  ).toBe(true);
});

test('changing the order goes back to choosing, even for a customer with only one order owing', async ({ page }) => {
  await mockPayments(page);
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({ json: { items: [{ ...OWING }], page: 1, pageSize: 100, total: 1 } }),
  );

  await page.goto(`/payments/new?customerId=${CUSTOMER.id}`);
  await expect(page).toHaveURL(/orderId=9/);
  await page.getByRole('button', { name: 'Change order' }).click();

  // The single order would otherwise be chosen again at once, and there would be no way out.
  await expect(page.getByRole('button', { name: /#123456/ })).toBeVisible();
  await page.waitForTimeout(300);
  expect(new URL(page.url()).searchParams.get('orderId')).toBeNull();
  await expect(page.getByRole('combobox', { name: 'Customer' })).toBeVisible();
});

test('an order with nothing owed any more offers no form, only the way back to it', async ({ page }) => {
  await mockPayments(page, { ...OWING, owed: 0 });

  await page.goto('/payments/new?orderId=9');

  await expect(page.getByText('Nothing is owed on this order')).toBeVisible();
  await expect(page.getByLabel('Amount')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to the order' })).toHaveAttribute('href', '/orders/9');
});

test('a customer with more open orders than one page can still reach the oldest', async ({ page }) => {
  await mockPayments(page);
  // 100 newest orders that owe nothing, then one older one that does.
  const settled = Array.from({ length: 100 }, (_, index): OrderListItemDto => ({
    ...OWING,
    id: 1_000 + index,
    orderNumber: 5_000 + index,
    owed: 0,
  }));
  const oldest: OrderListItemDto = { ...OWING, id: 9, orderNumber: 42 };
  await page.route(/\/api\/orders\?/, (route) => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    return route.fulfill({
      json: { items: second ? [oldest] : settled, page: second ? 2 : 1, pageSize: 100, total: 101 },
    });
  });

  await page.goto(`/payments/new?customerId=${CUSTOMER.id}`);
  const more = page.getByRole('button', { name: 'Show older orders' });
  await expect(more).toBeVisible();
  // Not chosen for the user while orders are still unseen.
  await expect(page).not.toHaveURL(/orderId=/);
  await more.click();

  // Every open order seen now, and only the oldest owes: it is chosen, as a single qualifying order always is.
  await expect(page).toHaveURL(/orderId=9/);
  await expect(page.getByLabel('Amount')).toBeVisible();
});

test('older orders stay whole when an order is created while the customer is being chosen', async ({ page }) => {
  await mockPayments(page);
  const settled = (from: number, count: number) =>
    Array.from({ length: count }, (_, index): OrderListItemDto => ({
      ...OWING,
      id: from + index,
      orderNumber: from + index,
      owed: 0,
    }));
  const owing: OrderListItemDto = { ...OWING, id: 9, orderNumber: 42 };
  let created = false;
  await page.route(/\/api\/orders\?/, (route) => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    // Before: 99 settled orders then the one owing on page 1, one more settled on page 2.
    // After a new order: every row moves down one place, and the owing one opens page 2 as well.
    const items = created
      ? second
        ? [owing, ...settled(1, 1)]
        : [...settled(9_000, 1), ...settled(2_000, 98), ...settled(3_000, 1)]
      : second
        ? settled(1, 1)
        : [...settled(2_000, 98), ...settled(3_000, 1), owing];
    return route.fulfill({ json: { items, page: second ? 2 : 1, pageSize: 100, total: created ? 102 : 101 } });
  });

  await page.goto(`/payments/new?customerId=${CUSTOMER.id}`);
  const more = page.getByRole('button', { name: 'Show older orders' });
  await expect(more).toBeVisible();
  created = true;
  await more.click();

  // Read again from the start: the owing order shows once, and as the only one it is chosen.
  await expect(page).toHaveURL(/orderId=9/);
});
