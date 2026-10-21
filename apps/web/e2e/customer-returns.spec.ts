import type {
  CustomerReturnRecordedDto,
  CustomerReturnResultDto,
  CustomerReturnableDto,
  OrderLineDto,
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

/** A credit order owing 60,000 on 100 euro pallets, and a cash order of 10 crates paid in full. */
const HOLDINGS: CustomerReturnableDto = {
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
};

const recorded = (entry: Partial<CustomerReturnRecordedDto> & { orderId: number }): CustomerReturnRecordedDto => ({
  returnId: entry.orderId + 100,
  orderNumber: entry.orderId + 32,
  accepted: 0,
  damaged: 0,
  refundDue: 0,
  owedBefore: 0,
  cashRefund: 0,
  owedAfter: 0,
  refundEntryId: null,
  ...entry,
});

async function mockHoldings(page: Page, answer: CustomerReturnResultDto | { status: number; json: unknown }) {
  await mockApi(page, ADMIN, 'en');
  let reads = 0;
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => {
    reads += 1;
    return route.fulfill({ json: HOLDINGS });
  });
  const sent: { body: unknown; key?: string }[] = [];
  await page.route(/\/api\/customers\/3\/returns$/, (route) => {
    sent.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    return 'status' in answer
      ? route.fulfill(answer)
      : route.fulfill({ status: 201, json: answer satisfies CustomerReturnResultDto });
  });
  return { sent, reads: () => reads };
}

const summary = (page: Page) => page.getByRole('complementary', { name: 'Summary' });
const figure = (page: Page, label: string) =>
  summary(page).getByText(label, { exact: true }).locator('..').locator('dd');
const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const plain = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');

test('Q156: the customer’s pallets show by order, are counted with buttons, and one save records them all', async ({
  page,
}) => {
  const { sent } = await mockHoldings(page, {
    customer: HOLDINGS.customer,
    returns: [
      recorded({ orderId: 9, accepted: 3, refundDue: 3_000, owedBefore: 60_000, owedAfter: 57_000 }),
      recorded({ orderId: 10, accepted: 10, refundDue: 5_000, cashRefund: 5_000, refundEntryId: 88 }),
    ],
  });
  await page.route(/\/api\/ledger-entries\/88\/receipt$/, (route) => route.fulfill({ status: 404, json: {} }));

  await page.goto('/returns/new');
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: new RegExp(CUSTOMER.name.slice(0, 20)) }).click();
  await expect(page).toHaveURL(/customerId=3/);
  await expect(page.getByText('Pallets out: 110 · Orders: 2')).toBeVisible();

  // Each order's number opens it beside the form, which keeps what was typed.
  const link = page.getByRole('link', { name: /#000041/ });
  await expect(link).toHaveAttribute('href', '/orders/9');
  await expect(link).toHaveAttribute('target', '_blank');

  const euro = row(page, 'Euro pallet');
  for (let press = 0; press < 3; press += 1) await euro.getByRole('button', { name: 'One more' }).click();
  await expect(euro.getByLabel('Accepted')).toHaveValue('3');
  await row(page, 'Crate').getByRole('button', { name: 'All', exact: true }).click();
  await expect(row(page, 'Crate').getByLabel('Accepted')).toHaveValue('10');
  await expect(row(page, 'Crate').getByRole('button', { name: 'One more' })).toBeDisabled();

  // Each order's return priced on its own: the credit order's 3,000 lowers what it owes, the cash order's 5,000 is paid.
  await expect(figure(page, 'Pallets coming back')).toHaveText('13');
  await expect(figure(page, 'Refund due')).toHaveText(/^8,000/);
  await expect(figure(page, 'Owed before')).toHaveText(/^60,000/);
  await expect(figure(page, 'Owed after')).toHaveText(/^57,000/);
  await expect(figure(page, 'Still out after')).toHaveText('97');
  expect(
    plain(
      await summary(page)
        .getByText(/Hand the customer/)
        .textContent(),
    ),
  ).toBe('Hand the customer 5,000 IQD now');

  await summary(page).getByRole('button', { name: 'Record return' }).click();
  const saved = page.getByRole('dialog');
  await expect(saved).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.key).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  expect(sent[0]?.body).toEqual({
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
    notes: null,
    orders: [
      { orderId: 9, lines: [{ orderLineId: 21, acceptedQuantity: 3, damagedQuantity: 0, damagedRefund: 0 }] },
      { orderId: 10, lines: [{ orderLineId: 22, acceptedQuantity: 10, damagedQuantity: 0, damagedRefund: 0 }] },
    ],
  });

  // Only the order that paid cash has a receipt to print; the dialog stays while it prints.
  await expect(saved.getByRole('button', { name: 'Print money receipt' })).toHaveCount(1);
  await Promise.all([
    page.waitForRequest(/\/api\/ledger-entries\/88\/receipt$/),
    saved.getByRole('button', { name: 'Print money receipt' }).click(),
  ]);
  await expect(saved).toBeVisible();

  // Closed, the flow goes on to the customer, whose orders it changed.
  await saved.getByRole('button', { name: 'Close' }).first().click();
  await expect(page).toHaveURL(/\/customers\/3$/);
});

test('Q156: more than is out is refused as it is typed, and the save stays off', async ({ page }) => {
  const { sent } = await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');

  const euro = row(page, 'Euro pallet');
  await euro.getByLabel('Accepted').fill('101');
  await expect(euro.getByText('At most 100 are out')).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
  await expect(figure(page, 'Pallets coming back')).toHaveText('0');

  // Damaged pallets count against what is out too.
  await euro.getByLabel('Accepted').fill('95');
  await euro.getByRole('button', { name: 'Damaged' }).click();
  await euro.getByLabel('Damaged', { exact: true }).fill('6');
  await expect(euro.getByText('At most 100 are out')).toBeVisible();
  await euro.getByLabel('Damaged', { exact: true }).fill('5');
  await expect(euro.getByText('At most 100 are out')).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
  expect(sent).toHaveLength(0);
});

test('Q156: a return on one order that pays nothing out goes to that order', async ({ page }) => {
  const { sent } = await mockHoldings(page, {
    customer: HOLDINGS.customer,
    returns: [recorded({ orderId: 9, accepted: 100, refundDue: 100_000, owedBefore: 60_000, cashRefund: 0 })],
  });
  await page.goto('/returns/new?customerId=3');

  await page.getByRole('button', { name: 'Record return' }).last().click();
  await expect(page.getByText('Enter at least one returned pallet')).toBeVisible();
  expect(sent).toHaveLength(0);

  await page.getByRole('button', { name: 'All of this order back' }).first().click();
  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect(page).toHaveURL(/\/orders\/9$/);
  await expect(page.getByText('Return recorded on order #000041')).toBeVisible();
});

test('Q156: lines over what is out by the time it is saved are marked, and the list is read again', async ({
  page,
}) => {
  const { reads } = await mockHoldings(page, {
    status: 409,
    json: {
      error: { code: 'RETURN_EXCEEDS_OUT', details: { lines: [{ orderLineId: 22, requested: 10, outQuantity: 4 }] } },
    },
  });
  await page.goto('/returns/new?customerId=3');
  await row(page, 'Crate').getByRole('button', { name: 'All', exact: true }).click();
  const before = reads();

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(row(page, 'Crate').getByText('At most 4 are out')).toBeVisible();
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(page).toHaveURL(/customerId=3/);
});

test('Q156: a row’s count box and buttons stand on one line, one height', async ({ page }) => {
  await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');

  const euro = row(page, 'Euro pallet');
  const controls = [
    euro.getByRole('button', { name: 'One fewer' }),
    euro.getByLabel('Accepted'),
    euro.getByRole('button', { name: 'One more' }),
    euro.getByRole('button', { name: 'All', exact: true }),
    euro.getByRole('button', { name: 'Damaged' }),
  ];
  const boxes = await Promise.all(controls.map(async (control) => control.boundingBox()));
  const [first] = boxes;
  for (const box of boxes) {
    expect(box?.y).toBe(first?.y);
    expect(box?.height).toBe(first?.height);
  }
});

test('Q156: a count on pallets a reload no longer lists is named, keeps the save off, and is let go on request', async ({
  page,
}) => {
  await mockHoldings(page, {
    status: 409,
    json: {
      error: { code: 'RETURN_EXCEEDS_OUT', details: { lines: [{ orderLineId: 21, requested: 5, outQuantity: 0 }] } },
    },
  });
  await page.goto('/returns/new?customerId=3');
  await row(page, 'Euro pallet').getByLabel('Accepted').fill('5');
  await row(page, 'Crate').getByLabel('Accepted').fill('2');
  // Meanwhile every euro pallet came back on another screen: the reload no longer lists order #000041.
  await page.route(/\/api\/customers\/3\/returnable$/, (route) =>
    route.fulfill({ json: { ...HOLDINGS, orders: HOLDINGS.orders.slice(1) } }),
  );

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  const notice = page.getByRole('alert').filter({ hasText: 'no longer out' });
  await expect(notice).toBeVisible();
  expect(plain(await notice.getByRole('listitem').textContent())).toBe('#000041 · Euro pallet · 5');
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();

  await notice.getByRole('button', { name: 'Remove them' }).click();
  await expect(notice).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
  await expect(figure(page, 'Pallets coming back')).toHaveText('2');
});

test('Q156: a date before an order being returned is refused as it is typed', async ({ page }) => {
  await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');
  const date = page.getByLabel('Date', { exact: true });

  // Only the 1 September order: the 3rd is fine.
  await row(page, 'Euro pallet').getByLabel('Accepted').fill('1');
  await date.fill('03/09/2026');
  await date.press('Tab');
  await expect(page.getByText('The return is dated before the order')).toHaveCount(0);

  // The 5 September order too: the 3rd is before it.
  await row(page, 'Crate').getByLabel('Accepted').fill('1');
  await expect(page.getByText('The return is dated before the order')).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();

  await date.fill('05/09/2026');
  await date.press('Tab');
  await expect(page.getByText('The return is dated before the order')).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
});

test('Q156: a count cleared and typed again reads as typed, not after a 0 put back in front of it', async ({
  page,
}) => {
  await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');
  const box = row(page, 'Euro pallet').getByLabel('Accepted');

  await box.fill('3');
  await box.press('Backspace');
  await box.pressSequentially('5');

  await expect(box).toHaveValue('5');
  await expect(figure(page, 'Pallets coming back')).toHaveText('5');
});

test('Q156: a line taken off an order meanwhile reads the list again and names the count left on it', async ({
  page,
}) => {
  await mockHoldings(page, {
    status: 400,
    json: { error: { code: 'RETURN_LINE_NOT_IN_ORDER', details: { orderLineId: 22 } } },
  });
  await page.goto('/returns/new?customerId=3');
  await row(page, 'Crate').getByLabel('Accepted').fill('2');
  await page.route(/\/api\/customers\/3\/returnable$/, (route) =>
    route.fulfill({ json: { ...HOLDINGS, orders: HOLDINGS.orders.slice(0, 1) } }),
  );

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(page.getByText("This customer's orders changed meanwhile", { exact: false })).toBeVisible();
  const notice = page.getByRole('alert').filter({ hasText: 'no longer out' });
  await expect(notice).toBeVisible();
  expect(plain(await notice.getByRole('listitem').textContent())).toBe('#000042 · Crate · 2');
});

test('Q156: more orders than one save takes is refused as they are ticked', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  const many: CustomerReturnableDto = {
    customer: HOLDINGS.customer,
    orders: Array.from({ length: 101 }, (_, index) => ({
      id: 1_000 + index,
      orderNumber: 1_000 + index,
      date: '2026-09-01',
      paymentType: 'LENT' as const,
      owed: 1_000,
      outQuantityTotal: 1,
      lines: [line(5_000 + index, `Pallet ${index}`, 1, 1_000)],
    })),
  };
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => route.fulfill({ json: many }));
  await page.goto('/returns/new?customerId=3');

  await page.getByRole('button', { name: 'Everything came back' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'at most 100 orders' })).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
});
