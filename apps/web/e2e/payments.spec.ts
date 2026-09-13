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
