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

  await row(page, 'Euro pallet').getByRole('button', { name: 'All', exact: true }).click();
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
  expect(plain(await notice.getByRole('listitem').textContent())).toBe('Euro pallet · 5');
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();

  await notice.getByRole('button', { name: 'Remove them' }).click();
  await expect(notice).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
  await expect(figure(page, 'Pallets coming back')).toHaveText('2');
});

test('Q156, Q160: a return dated before an order cannot take its pallets, refused as it is typed', async ({ page }) => {
  await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');
  const date = page.getByLabel('Date', { exact: true });

  // Only the 1 September order: the 3rd is fine.
  await row(page, 'Euro pallet').getByLabel('Accepted').fill('1');
  await date.fill('03/09/2026');
  await date.press('Tab');
  await expect(page.getByText('The return is dated before the order')).toHaveCount(0);

  // The crates went out on 5 September: on the 3rd none were out, so none can come back (Q160).
  await row(page, 'Crate').getByLabel('Accepted').fill('1');
  await expect(row(page, 'Crate').getByText('At most 0 are out')).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();

  await date.fill('05/09/2026');
  await date.press('Tab');
  await expect(row(page, 'Crate').getByText('At most 0 are out')).toHaveCount(0);
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
  expect(plain(await notice.getByRole('listitem').textContent())).toBe('Crate · 2');
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

  await expect(page.getByRole('alert').filter({ hasText: 'one save takes at most 100' })).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
});

test('Q156: "Everything came back" counts the rest as accepted and keeps damaged pallets already typed', async ({
  page,
}) => {
  await mockHoldings(page, { customer: HOLDINGS.customer, returns: [] });
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByRole('button', { name: 'Damaged' }).click();
  await euro.getByLabel('Damaged', { exact: true }).fill('2');
  await euro.getByLabel('Damage refund').fill('500');

  await page.getByRole('button', { name: 'Everything came back' }).click();

  // 100 out: the 2 broken stay broken, with their refund, and the other 98 come back accepted.
  await expect(euro.getByLabel('Accepted')).toHaveValue('98');
  await expect(euro.getByLabel('Damaged', { exact: true })).toHaveValue('2');
  await expect(euro.getByLabel('Damage refund')).toHaveValue('500');
  await expect(figure(page, 'Pallets coming back')).toHaveText('110');
  await expect(figure(page, 'Compensation assessed')).toHaveText(/^1,500/);
});

test('Q156: a reload that finds nothing out any more still names the counts typed, then says nothing is out', async ({
  page,
}) => {
  await mockHoldings(page, {
    status: 409,
    json: { error: { code: 'ORDER_CANCELLED', details: { orderId: 9 } } },
  });
  await page.goto('/returns/new?customerId=3');
  await row(page, 'Euro pallet').getByLabel('Accepted').fill('5');
  // Meanwhile both orders were cancelled: the reload lists nothing.
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => route.fulfill({ json: { ...HOLDINGS, orders: [] } }));

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  const notice = page.getByRole('alert').filter({ hasText: 'no longer out' });
  await expect(notice).toBeVisible();
  expect(plain(await notice.getByRole('listitem').textContent())).toBe('Euro pallet · 5');
  // Nothing else that could not apply: no heading of what is out, no quick buttons, no save.
  await expect(page.getByText(/^Pallets out:/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Everything came back' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record return' })).toHaveCount(0);
  await notice.getByRole('button', { name: 'Remove them' }).click();
  await expect(page.getByText('This customer has no pallets out')).toBeVisible();
});

test('Q156: a damage refund the server refused stays refused through "Everything came back"', async ({ page }) => {
  await mockHoldings(page, {
    status: 400,
    json: { error: { code: 'DAMAGED_REFUND_TOO_HIGH', details: { orderLineId: 21, maximum: 1_000 } } },
  });
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByRole('button', { name: 'Damaged' }).click();
  await euro.getByLabel('Damaged', { exact: true }).fill('2');
  await euro.getByLabel('Damage refund').fill('1500');
  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect(euro.getByText('At most 1,000')).toBeVisible();

  await page.getByRole('button', { name: 'Everything came back' }).click();

  // The count moved, the refund did not: its refusal stands, and nothing can be sent.
  await expect(euro.getByLabel('Accepted')).toHaveValue('98');
  await expect(euro.getByText('At most 1,000')).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
});

/** One item out on two orders, 26 on each (Q160); #000043 was entered later but is dated earlier, so it is older. */
const SAME_ITEM: CustomerReturnableDto = {
  customer: HOLDINGS.customer,
  orders: [
    {
      id: 41,
      orderNumber: 41,
      date: '2026-09-10',
      paymentType: 'LENT',
      owed: 182_000,
      outQuantityTotal: 26,
      lines: [
        {
          ...line(31, 'Euro pallet', 26, 7_000),
          item: { id: 5, name: 'Euro pallet', imageUrl: null, archived: false },
        },
      ],
    },
    {
      id: 43,
      orderNumber: 43,
      date: '2026-09-01',
      paymentType: 'LENT',
      owed: 182_000,
      outQuantityTotal: 26,
      lines: [
        {
          ...line(33, 'Euro pallet', 26, 7_000),
          item: { id: 5, name: 'Euro pallet', imageUrl: null, archived: false },
        },
      ],
    },
  ],
};

async function mockSameItem(page: Page) {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => route.fulfill({ json: SAME_ITEM }));
  const sent: unknown[] = [];
  await page.route(/\/api\/customers\/3\/returns$/, (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: {
        customer: SAME_ITEM.customer,
        returns: [recorded({ orderId: 41 }), recorded({ orderId: 43 })],
      } satisfies CustomerReturnResultDto,
    });
  });
  return sent;
}

const split = (page: Page) => page.locator('[id$="-split"]').first();
/** The split as it reads on screen: the links' screen-reader note left out, spaces collapsed. */
const splitText = async (page: Page) =>
  plain(await split(page).textContent())
    .replace(/\(opens in a new tab\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('Q160: an item out on two orders is one row, and a count is placed oldest order first', async ({ page }) => {
  const sent = await mockSameItem(page);
  await page.goto('/returns/new?customerId=3');

  // One row: 26 + 26.
  await expect(page.getByRole('listitem').filter({ hasText: 'Euro pallet' })).toHaveCount(1);
  const euro = row(page, 'Euro pallet');
  await expect(euro).toContainText('Out: 52');
  // The older by date first, whatever the order numbers.
  expect(await splitText(page)).toBe('On orders#000043 (01/09/2026)26#000041 (10/09/2026)26');

  // The business's example: 50 back — 26 close the older order, 24 come off the newer, 2 left there.
  await euro.getByLabel('Accepted').fill('50');
  expect(await splitText(page)).toBe('Split over#000043 (01/09/2026)26/26#000041 (10/09/2026)24/26');
  await expect(split(page).getByLabel('all back')).toHaveCount(1);
  await expect(figure(page, 'Pallets coming back')).toHaveText('50');
  await expect(figure(page, 'Still out after')).toHaveText('2');
  // Each order's own return: the newer one still owes 182,000 − 24 × 7,000.
  const byOrder = summary(page).getByRole('list', { name: 'By order' });
  expect(plain(await byOrder.getByRole('listitem').filter({ hasText: '#000041' }).textContent())).toBe(
    '#00004124 back · owes 14,000 IQD',
  );

  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { orders: unknown[] }).orders).toEqual([
    { orderId: 41, lines: [{ orderLineId: 31, acceptedQuantity: 24, damagedQuantity: 0, damagedRefund: 0 }] },
    { orderId: 43, lines: [{ orderLineId: 33, acceptedQuantity: 26, damagedQuantity: 0, damagedRefund: 0 }] },
  ]);
});

test('Q160: damaged pallets and their refund go on the oldest order first too', async ({ page }) => {
  const sent = await mockSameItem(page);
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByLabel('Accepted').fill('30');
  await euro.getByRole('button', { name: 'Damaged' }).click();
  await euro.getByLabel('Damaged', { exact: true }).fill('3');
  await euro.getByLabel('Damage refund').fill('5000');

  // 33 back: the older order takes its 26 (the 3 damaged first), the newer the other 7.
  expect(await splitText(page)).toBe('Split over#000043 (01/09/2026)26/26#000041 (10/09/2026)7/26');
  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { orders: unknown[] }).orders).toEqual([
    { orderId: 41, lines: [{ orderLineId: 31, acceptedQuantity: 7, damagedQuantity: 0, damagedRefund: 0 }] },
    { orderId: 43, lines: [{ orderLineId: 33, acceptedQuantity: 23, damagedQuantity: 3, damagedRefund: 5_000 }] },
  ]);
});

test('Q160: more than the item has out over all its orders is refused as typed', async ({ page }) => {
  await mockSameItem(page);
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');

  await euro.getByLabel('Accepted').fill('53');

  await expect(euro.getByText('At most 52 are out')).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
});

test('Q160: an order cancelled meanwhile moves the count to the other order only after a look', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  let reads = 0;
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => {
    reads += 1;
    // After the refusal the older order is gone: the 20 can only come off the newer one.
    return route.fulfill({ json: reads === 1 ? SAME_ITEM : { ...SAME_ITEM, orders: SAME_ITEM.orders.slice(0, 1) } });
  });
  await page.route(/\/api\/customers\/3\/returns$/, (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'ORDER_CANCELLED', details: { orderId: 43 } } } }),
  );
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByLabel('Accepted').fill('20');
  expect(await splitText(page)).toBe('Split over#000043 (01/09/2026)20/26#000041 (10/09/2026)0/26');

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  // Placed again on what is left, and held for a look: nothing moves to another order without a word.
  await expect.poll(() => splitText(page)).toBe('Split over#000041 (10/09/2026)20/26');
  const notice = page.getByRole('alert').filter({ hasText: 'placed again' });
  await expect(notice.getByRole('listitem')).toHaveText(['Euro pallet']);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
  await notice.getByRole('button', { name: "I've checked" }).click();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
});

test('Q160: a refused count that still fits what is out now is placed again for a look, not refused', async ({
  page,
}) => {
  await mockApi(page, ADMIN, 'en');
  // 6 of the older order's 26 came back elsewhere: 40 still fits the 46 out, placed 20 and 20 on the list read again.
  let reads = 0;
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => {
    reads += 1;
    const older = SAME_ITEM.orders[1]!;
    return route.fulfill({
      json:
        reads === 1
          ? SAME_ITEM
          : {
              ...SAME_ITEM,
              orders: [
                SAME_ITEM.orders[0],
                { ...older, outQuantityTotal: 20, lines: [{ ...older.lines[0]!, outQuantity: 20 }] },
              ],
            },
    });
  });
  await page.route(/\/api\/customers\/3\/returns$/, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'RETURN_EXCEEDS_OUT',
          details: { lines: [{ orderLineId: 33, requested: 26, outQuantity: 20 }] },
        },
      },
    }),
  );
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByLabel('Accepted').fill('40');

  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'placed again' })).toBeVisible();
  await expect(euro.getByText(/^At most/)).toHaveCount(0);
  // Editing the row is a look too.
  await euro.getByRole('button', { name: 'One more' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'placed again' })).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeEnabled();
});

test('Q160: a return dated before an order places nothing on it and counts only what was out by then', async ({
  page,
}) => {
  await mockSameItem(page);
  await page.goto('/returns/new?customerId=3');
  const date = page.getByLabel('Date', { exact: true });
  await date.fill('05/09/2026');
  await date.press('Tab');
  const euro = row(page, 'Euro pallet');

  expect(plain(await euro.textContent())).toContain('Out: 52 · 26 by 05/09/2026');
  await euro.getByLabel('Accepted').fill('20');
  // Only the order of 1 September was out on the 5th; the one of the 10th shows a dash.
  expect(await splitText(page)).toBe('Split over#000043 (01/09/2026)20/26#000041 (10/09/2026)—dated after the return');
  await euro.getByLabel('Accepted').fill('30');
  await expect(euro.getByText('At most 26 are out')).toBeVisible();
  await expect(page.getByText('The return is dated before the order')).toHaveCount(0);
});

test('Q160: a split moved by a list read again in the background is held for a look too', async ({ page }) => {
  await page.clock.install();
  await mockApi(page, ADMIN, 'en');
  let changed = false;
  await page.route(/\/api\/customers\/3\/returnable$/, (route) =>
    // Meanwhile the older order's pallets all came back on another screen.
    route.fulfill({ json: changed ? { ...SAME_ITEM, orders: SAME_ITEM.orders.slice(0, 1) } : SAME_ITEM }),
  );
  await page.goto('/returns/new?customerId=3');
  const euro = row(page, 'Euro pallet');
  await euro.getByLabel('Accepted').fill('10');
  expect(await splitText(page)).toBe('Split over#000043 (01/09/2026)10/26#000041 (10/09/2026)0/26');

  // Back to this tab a minute later (an order looked at in another): the list is read again, and the 10 can only
  // come off the newer order now.
  changed = true;
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => splitText(page)).toBe('Split over#000041 (10/09/2026)10/26');
  const notice = page.getByRole('alert').filter({ hasText: 'placed again' });
  await expect(notice.getByRole('listitem')).toHaveText(['Euro pallet']);
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
});
