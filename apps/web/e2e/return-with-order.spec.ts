import type { CustomerReturnResultDto, CustomerReturnableDto, OrderDetailDto, OrderLineDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';

const line = (id: number, name: string, out: number): OrderLineDto => ({
  id,
  item: { id, name, imageUrl: null, archived: false },
  quantity: out,
  unitDeposit: 1_000,
  lineTotal: out * 1_000,
  returnedAccepted: 0,
  returnedDamaged: 0,
  outQuantity: out,
});

/** The customer of order #123456 (id 9) holds euro pallets of an older order and crates of this one. */
const HOLDINGS: CustomerReturnableDto = {
  customer: ORDER.customer,
  orders: [
    {
      id: 7,
      orderNumber: 41,
      date: '2026-09-01',
      paymentType: 'LENT',
      owed: 0,
      outQuantityTotal: 10,
      lines: [line(21, 'Euro pallet', 10)],
    },
    {
      id: 9,
      orderNumber: ORDER.orderNumber,
      date: '2026-09-11',
      paymentType: 'LENT',
      owed: 0,
      outQuantityTotal: 4,
      lines: [line(22, 'Crate', 4)],
    },
  ],
};

async function mockFromOrder(page: Page, order: OrderDetailDto = ORDER, holdings: CustomerReturnableDto = HOLDINGS) {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: order }));
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => route.fulfill({ json: holdings }));
  const sent: unknown[] = [];
  await page.route(/\/api\/customers\/3\/returns$/, (route) => {
    sent.push(route.request().postDataJSON());
    const result: CustomerReturnResultDto = {
      customerReturnId: null,
      customer: HOLDINGS.customer,
      surplus: [],
      returns: [
        {
          returnId: 50,
          orderId: 7,
          orderNumber: 41,
          accepted: 10,
          damaged: 0,
          refundDue: 0,
          owedBefore: 0,
          cashRefund: 0,
          owedAfter: 0,
          refundEntryId: null,
        },
      ],
    };
    return route.fulfill({ status: 201, json: result });
  });
  return { sent };
}

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

test('Q175: a return from an order lists everything the customer holds, remembers the order, and goes back to it', async ({
  page,
}) => {
  const { sent } = await mockFromOrder(page);
  await page.goto('/orders/9');
  await page.getByRole('link', { name: 'Record return' }).click();
  await expect(page).toHaveURL(/\/returns\/new\?orderId=9$/);
  await expect(page.getByText(/Returning with order .*#123456/)).toBeVisible();
  // Every order's pallets, the older order's too: this order's crates outlined under its number first (Q176).
  const own = page.getByRole('region', { name: /On order .*#123456/ });
  await expect(own).toContainText('Counts go to the oldest order first');
  await expect(own.getByRole('listitem').filter({ hasText: 'Crate' })).toBeVisible();
  await expect(own.getByRole('listitem').filter({ hasText: 'Euro pallet' })).toHaveCount(0);
  const others = page.getByRole('region', { name: 'Other orders' });
  await expect(others.getByRole('listitem').filter({ hasText: 'Euro pallet' })).toBeVisible();

  await row(page, 'Euro pallet').getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Record return' }).click();
  const saved = page.getByRole('dialog', { name: 'Return recorded' });
  await expect(saved).toBeVisible();
  expect(sent).toEqual([
    {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
      notes: null,
      orders: [
        { orderId: 7, lines: [{ orderLineId: 21, acceptedQuantity: 10, damagedQuantity: 0, damagedRefund: 0 }] },
      ],
      surplus: [],
      withOrderId: 9,
    },
  ]);

  // Closed, back to the order it was recorded with, not the customer.
  await saved.getByRole('button', { name: 'Close' }).first().click();
  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('Q175: a return recorded with another order names that order as a link to it', async ({ page }) => {
  const returned: OrderDetailDto = {
    ...ORDER,
    returns: [
      {
        id: 5,
        orderId: 9,
        orderNumber: ORDER.orderNumber,
        date: '2026-09-12',
        notes: null,
        refundDue: 0,
        owedBefore: 0,
        cashRefund: 0,
        lines: [],
        reversed: false,
        reversedAt: null,
        reversedBy: null,
        reversalKind: null,
        replacedByReturnId: null,
        replacesReturnId: null,
        canReverse: true,
        createdAt: '2026-09-12T08:00:00.000Z',
        createdBy: ORDER.createdBy,
        customerReturnId: null,
        withOrder: { id: 12, orderNumber: 50 },
      },
    ],
  };
  await mockFromOrder(page, returned);
  await page.goto('/orders/9');
  await expect(page.getByRole('link', { name: /With order .*#000050/ }).first()).toHaveAttribute('href', '/orders/12');
});

test('Q175: a return dated before the order it is recorded with is refused as typed', async ({ page }) => {
  const { sent } = await mockFromOrder(page);
  await page.goto('/returns/new?orderId=9');
  await row(page, 'Euro pallet').getByRole('button', { name: 'All', exact: true }).click();
  const date = page.getByLabel('Date', { exact: true });
  await date.fill('01/09/2026');
  await date.blur();
  await expect(page.getByRole('alert').filter({ hasText: 'The return is dated before the order' })).toBeVisible();
  const save = page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Record return' });
  await expect(save).toBeDisabled();

  await date.fill('11/09/2026');
  await date.blur();
  await expect(page.getByRole('alert').filter({ hasText: 'The return is dated before the order' })).toHaveCount(0);
  await expect(save).toBeEnabled();
  expect(sent).toHaveLength(0);
});

test('Q175: the order re-dated after the return is read again, and its date refused as typed', async ({ page }) => {
  await mockFromOrder(page);
  let orderReads = 0;
  await page.route(/\/api\/orders\/9$/, (route) => {
    orderReads += 1;
    // Meanwhile the order was re-dated to a day after the return's.
    return route.fulfill({ json: orderReads === 1 ? ORDER : { ...ORDER, date: '2099-01-01' } });
  });
  await page.route(/\/api\/customers\/3\/returns$/, (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: 'RETURN_DATE_BEFORE_ORDER_DATE', details: { orderDate: '2099-01-01' } } },
    }),
  );
  await page.goto('/returns/new?orderId=9');
  await row(page, 'Euro pallet').getByRole('button', { name: 'All', exact: true }).click();
  const save = page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: 'Record return' });
  await save.click();
  await expect(page.getByRole('alert').filter({ hasText: 'The return is dated before the order' })).toBeVisible();
  await expect(save).toBeDisabled();
});

test('Q176: an item on this order and an older one says how many are on this order', async ({ page }) => {
  const [older, own] = HOLDINGS.orders;
  const euro = line(21, 'Euro pallet', 10);
  await mockFromOrder(page, ORDER, {
    ...HOLDINGS,
    orders: [
      { ...older!, outQuantityTotal: 10, lines: [euro] },
      { ...own!, outQuantityTotal: 6, lines: [{ ...line(23, 'Euro pallet', 6), item: euro.item }] },
    ],
  });
  await page.goto('/returns/new?orderId=9');
  const region = page.getByRole('region', { name: /On order .*#123456/ });
  await expect(region.getByRole('listitem').filter({ hasText: 'Euro pallet' })).toContainText(/6.? on this order/);
  await expect(page.getByRole('region', { name: 'Other orders' })).toHaveCount(0);
});

test('Q176: an order with nothing out says so above the other orders', async ({ page }) => {
  await mockFromOrder(page, ORDER, { ...HOLDINGS, orders: [HOLDINGS.orders[0]!] });
  await page.goto('/returns/new?orderId=9');
  await expect(page.getByRole('region', { name: /On order .*#123456/ })).toContainText(
    'Nothing is out on this order any more.',
  );
  await expect(page.getByRole('region', { name: 'Other orders' }).getByRole('listitem')).toHaveCount(1);
});
