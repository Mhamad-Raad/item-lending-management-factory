import type {
  CustomerReturnEditableDto,
  CustomerReturnResultDto,
  MeDto,
  OrderLineDto,
  PageDto,
  ReturnListItemDto,
} from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, CUSTOMER, mockApi } from './mock-api';

const line = (id: number, name: string, out: number, unitDeposit: number): OrderLineDto => ({
  id,
  item: { id, name, imageUrl: null, archived: false },
  quantity: out,
  unitDeposit,
  lineTotal: out * unitDeposit,
  returnedAccepted: 0,
  returnedDamaged: 0,
  outQuantity: out,
});

/** A visit that took 3 euro pallets off a credit order and all 10 crates of a cash order, paying 5,000 back. */
const EDITABLE: CustomerReturnEditableDto = {
  customer: { id: CUSTOMER.id, name: 'Kurdistan Cement', phone: CUSTOMER.phone, archived: false },
  orders: [
    {
      id: 9,
      orderNumber: 41,
      date: '2026-09-01',
      paymentType: 'LENT',
      owed: 60_000,
      outQuantityTotal: 100,
      lines: [line(21, 'Euro pallet', 100, 1_000)],
    },
    {
      id: 10,
      orderNumber: 42,
      date: '2026-09-05',
      paymentType: 'CASH',
      owed: 0,
      outQuantityTotal: 10,
      lines: [line(22, 'Crate', 10, 500)],
    },
  ],
  returnId: 55,
  customerReturnId: 7,
  withOrder: null,
  date: '2026-09-08',
  notes: 'first count',
  cashRefunded: 5_000,
  reopened: [],
  items: [
    { itemId: 21, accepted: 3, damaged: 0, damagedRefund: 0 },
    { itemId: 22, accepted: 10, damaged: 0, damagedRefund: 0 },
  ],
  lines: [
    { orderLineId: 21, accepted: 3, damaged: 0, damagedRefund: 0 },
    { orderLineId: 22, accepted: 10, damaged: 0, damagedRefund: 0 },
  ],
};

const RESULT: CustomerReturnResultDto = {
  customerReturnId: 8,
  customer: EDITABLE.customer,
  surplus: [],
  returns: [
    {
      returnId: 60,
      orderId: 9,
      orderNumber: 41,
      accepted: 3,
      damaged: 0,
      refundDue: 3_000,
      owedBefore: 60_000,
      cashRefund: 0,
      owedAfter: 57_000,
      refundEntryId: null,
    },
    {
      returnId: 61,
      orderId: 10,
      orderNumber: 42,
      accepted: 8,
      damaged: 0,
      refundDue: 4_000,
      owedBefore: 0,
      cashRefund: 4_000,
      owedAfter: 0,
      refundEntryId: 90,
    },
  ],
};

const LISTED: ReturnListItemDto = {
  id: 55,
  date: '2026-09-08',
  orderId: 10,
  orderNumber: 42,
  customer: EDITABLE.customer,
  accepted: 10,
  damaged: 0,
  refundDue: 5_000,
  cashRefund: 5_000,
  reversed: false,
  refundEntryId: 88,
  customerReturnId: 7,
  withOrder: null,
  createdAt: '2026-09-08T09:00:00Z',
  createdBy: { id: 1, username: 'admin', displayName: 'Hawre Abdulrahman Mohammed' },
};

async function mockEdit(page: Page, user: MeDto = ADMIN) {
  await mockApi(page, user, 'en');
  await page.route(/\/api\/returns(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [LISTED, { ...LISTED, id: 54, reversed: true }],
        total: 2,
        page: 1,
        pageSize: 25,
      } as PageDto<ReturnListItemDto>,
    }),
  );
  await page.route(/\/api\/returns\/55\/editable$/, (route) => route.fulfill({ json: EDITABLE }));
  const sent: { body: unknown; key?: string }[] = [];
  await page.route(/\/api\/returns\/55\/replace-customer$/, (route) => {
    sent.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: 201, json: RESULT });
  });
  return sent;
}

const summary = (page: Page) => page.getByRole('complementary', { name: 'Summary' });
const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const plain = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');

test('Q174: a return opens from the returns list with its counts, and saves the difference in cash', async ({
  page,
}) => {
  const sent = await mockEdit(page);
  await page.goto('/returns');
  // Only a standing return is edited; a reversed one has nothing.
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/returns\/55\/edit$/);
  await expect(page.getByRole('heading', { name: 'Edit return' })).toBeVisible();

  await expect(row(page, 'Euro pallet').getByLabel('Accepted')).toHaveValue('3');
  await expect(row(page, 'Crate').getByLabel('Accepted')).toHaveValue('10');
  await expect(page.getByLabel('Notes')).toHaveValue('first count');

  // Nothing changed yet: no money changes hands.
  await expect(summary(page).getByText(/paid back already/)).toHaveCount(0);
  await expect(summary(page).getByText(/Hand the customer/)).toHaveCount(0);

  const crates = row(page, 'Crate');
  await crates.getByRole('button', { name: 'One fewer' }).click();
  await crates.getByRole('button', { name: 'One fewer' }).click();
  expect(
    plain(
      await summary(page)
        .getByText(/paid back already/)
        .textContent(),
    ),
  ).toBe('5,000 IQD was paid back already — take 1,000 IQD back from the customer');

  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();
  const saved = page.getByRole('dialog');
  await expect(saved.getByRole('heading', { name: 'Return saved' })).toBeVisible();
  expect(plain(await saved.getByText(/paid back already/).textContent())).toBe(
    '5,000 IQD was paid back already — take 1,000 IQD back from the customer',
  );
  // Not idempotent, as a correction on the order's page: no key.
  expect(sent).toHaveLength(1);
  expect(sent[0]?.key).toBeUndefined();
  expect(sent[0]?.body).toEqual({
    date: '2026-09-08',
    notes: 'first count',
    orders: [
      { orderId: 9, lines: [{ orderLineId: 21, acceptedQuantity: 3, damagedQuantity: 0, damagedRefund: 0 }] },
      { orderId: 10, lines: [{ orderLineId: 22, acceptedQuantity: 8, damagedQuantity: 0, damagedRefund: 0 }] },
    ],
    surplus: [],
    reopened: [],
  });

  await saved.getByRole('button', { name: 'Close' }).first().click();
  await expect(page).toHaveURL(/\/returns(\?.*)?$/);
});

test('Q174: a return corrected or deleted meanwhile cannot be edited, with the way back to the list', async ({
  page,
}) => {
  await mockEdit(page);
  await page.route(/\/api\/returns\/55\/editable$/, (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'RETURN_ALREADY_REVERSED' }, requestId: 'x' } }),
  );
  await page.goto('/returns/55/edit');
  await expect(page.getByText('This return can no longer be corrected')).toBeVisible();
  await page.getByRole('link', { name: 'Back to returns' }).click();
  await expect(page).toHaveURL(/\/returns(\?.*)?$/);
});

test('Q174: a save refused because the return was corrected meanwhile goes back to the list', async ({ page }) => {
  await mockEdit(page);
  await page.route(/\/api\/returns\/55\/replace-customer$/, (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'RETURN_ALREADY_REVERSED' }, requestId: 'x' } }),
  );
  await page.goto('/returns/55/edit');
  await row(page, 'Crate').getByRole('button', { name: 'One fewer' }).click();
  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();
  await expect(page).toHaveURL(/\/returns(\?.*)?$/);
  await expect(page.getByText('This return was already changed — the list shows it as it is now')).toBeVisible();
});

test('Q174: an address naming no return says so, without asking the server', async ({ page }) => {
  await mockEdit(page);
  let asked = false;
  await page.route(/\/api\/returns\/[^/]+\/editable$/, (route) => {
    asked = true;
    return route.fulfill({ json: EDITABLE });
  });
  await page.goto('/returns/abc/edit');
  await expect(page.getByText('This return can no longer be corrected')).toBeVisible();
  expect(asked).toBe(false);
});

test('Q174: without the right to delete returns, an order the return was on must still take some back', async ({
  page,
}) => {
  await mockEdit(page, { ...ADMIN, role: 'EMPLOYEE', permissions: ['orders.view', 'returns.create', 'returns.edit'] });
  await page.goto('/returns/55/edit');
  const euro = row(page, 'Euro pallet');
  for (let press = 0; press < 3; press += 1) await euro.getByRole('button', { name: 'One fewer' }).click();
  const notice = page.getByRole('alert').filter({ hasText: 'You may not delete returns' });
  expect(plain(await notice.textContent())).toBe(
    'You may not delete returns: #000041 must still take some pallets back',
  );
  await expect(summary(page).getByRole('button', { name: 'Save the corrected return' })).toBeDisabled();
});

test('Q174: extra pallets given out after the screen opened send the save back to the list', async ({ page }) => {
  await mockEdit(page);
  await page.route(/\/api\/returns\/55\/replace-customer$/, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: { code: 'PALLET_CREDIT_GIVEN_BACK', details: { returnId: 55, itemId: 22, available: 0 } },
        requestId: 'x',
      },
    }),
  );
  await page.goto('/returns/55/edit');
  await row(page, 'Crate').getByRole('button', { name: 'One fewer' }).click();
  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();
  await expect(page).toHaveURL(/\/returns(\?.*)?$/);
  await expect(page.getByText('This return was already changed — the list shows it as it is now')).toBeVisible();
});
