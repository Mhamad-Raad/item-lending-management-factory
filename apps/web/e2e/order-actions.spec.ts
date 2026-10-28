import type { LedgerEntryDto, MeDto, OrderDetailDto, ReturnDto } from '@pallet/shared';
import type { Locator } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';

const ITEM_REF = ORDER.lines[0]?.item ?? { id: 5, name: 'Pallet', imageUrl: null, archived: false };
const PAYMENT = ORDER.ledgerEntries[0] as LedgerEntryDto;
const RETURN: ReturnDto = {
  id: 5,
  orderId: 9,
  orderNumber: ORDER.orderNumber,
  date: '2026-09-11',
  notes: null,
  refundDue: 20_000,
  owedBefore: 60_000,
  cashRefund: 0,
  lines: [
    {
      id: 1,
      orderLineId: 21,
      item: ITEM_REF,
      acceptedQuantity: 20,
      damagedQuantity: 0,
      unitDeposit: 1_000,
      damagedRefund: 0,
      compensation: 0,
    },
  ],
  reversed: false,
  reversedAt: null,
  reversedBy: null,
  reversalKind: null,
  replacedByReturnId: null,
  replacesReturnId: null,
  canReverse: true,
  createdAt: '2026-09-11T08:00:00.000Z',
  createdBy: ORDER.createdBy,
  customerReturnId: null,
  withOrder: null,
};

/** A credit order with a manual payment and a return recorded: something to undo on each side. */
const ACTIVE: OrderDetailDto = {
  ...ORDER,
  paymentType: 'LENT',
  status: 'OPEN',
  owed: 40_000,
  outQuantityTotal: 80,
  canEditLines: false,
  canCancel: false,
  version: 3,
  returns: [RETURN],
  ledgerEntries: [
    { ...PAYMENT, id: 11, type: 'PAYMENT', source: 'MANUAL', isAutomatic: false, canReverse: true, amount: 40_000 },
  ],
};

async function openOrder(page: Page, order: OrderDetailDto = ACTIVE, user: MeDto = ADMIN) {
  await mockApi(page, user, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: order }));
  const calls: { method: string; url: string; body: unknown }[] = [];
  await page.route(/\/api\/(returns\/5|ledger-entries\/11\/reverse)$/, (route) => {
    calls.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    const result = route.request().url().includes('ledger-entries')
      ? { ledgerEntryId: 12, order }
      : { returnId: 5, order };
    return route.fulfill({ json: result });
  });
  await page.goto('/orders/9');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return calls;
}

test('an open order offers to record a return and a payment, each on its own page', async ({ page }) => {
  await openOrder(page);

  await expect(page.getByRole('link', { name: 'Record return' })).toHaveAttribute('href', '/returns/new?orderId=9');
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveAttribute('href', '/payments/new?orderId=9');
  await expect(page.getByRole('link', { name: 'Edit return' })).toHaveAttribute(
    'href',
    '/returns/new?orderId=9&replaceReturnId=5',
  );
});

test('deleting a return asks first, then deletes it', async ({ page }) => {
  const calls = await openOrder(page);

  await page.getByRole('button', { name: 'Delete return' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete this return?');
  await dialog.getByRole('button', { name: 'Delete return' }).click();

  await expect(dialog).toBeHidden();
  expect(calls).toEqual([{ method: 'DELETE', url: expect.stringMatching(/\/api\/returns\/5$/), body: null }]);
});

test('deleting a manual payment takes an optional note with it', async ({ page }) => {
  const calls = await openOrder(page);

  await page.getByRole('button', { name: 'Delete payment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why (optional)').fill('Recorded on the wrong order');
  await dialog.getByRole('button', { name: 'Delete payment' }).click();

  await expect(dialog).toBeHidden();
  expect(calls).toEqual([
    {
      method: 'POST',
      url: expect.stringMatching(/\/api\/ledger-entries\/11\/reverse$/),
      body: { note: 'Recorded on the wrong order' },
    },
  ]);
});

test('Q137: a payment and a refund print their receipt; the rows that undo them do not', async ({ page, context }) => {
  await openOrder(page, {
    ...ACTIVE,
    ledgerEntries: [
      ...ACTIVE.ledgerEntries,
      {
        ...PAYMENT,
        id: 13,
        type: 'REFUND',
        source: 'RETURN_CREATE',
        isAutomatic: false,
        returnId: 5,
        canReverse: false,
      },
      {
        ...PAYMENT,
        id: 14,
        type: 'PAYMENT_REVERSAL',
        source: 'PAYMENT_DELETE',
        reversesEntryId: 11,
        canReverse: false,
      },
    ],
  });

  // The money table's own; the returns table prints its return's (Q166).
  const print = page.getByRole('table', { name: 'Transactions' }).getByRole('button', { name: 'Print money receipt' });
  await expect(print).toHaveCount(2);
  await Promise.all([page.waitForRequest(/\/api\/ledger-entries\/13\/receipt$/), print.nth(1).click()]);
  expect(context.pages()).toHaveLength(1);
});

test('Q166: each standing return prints its receipt: the one its saved dialog printed', async ({ page }) => {
  const refunded: ReturnDto = { ...RETURN, id: 6, cashRefund: 5_000 };
  const visited: ReturnDto = { ...RETURN, id: 8, cashRefund: 3_000, customerReturnId: 4 };
  const reversed: ReturnDto = { ...RETURN, id: 7, reversed: true, canReverse: false };
  await openOrder(page, {
    ...ACTIVE,
    returns: [RETURN, refunded, reversed, visited],
    ledgerEntries: [
      ...ACTIVE.ledgerEntries,
      { ...PAYMENT, id: 13, type: 'REFUND', source: 'RETURN_CREATE', amount: 5_000, returnId: 6, canReverse: false },
      // Part of a customer's return over several orders: its saved dialog printed the visit's one paper (Q161).
      {
        ...PAYMENT,
        id: 15,
        type: 'REFUND',
        source: 'RETURN_CREATE',
        amount: 3_000,
        returnId: 8,
        customerReturnId: 4,
        canReverse: false,
      },
    ],
  });
  // After the page's own mocks, so this route answers first.
  const read: string[] = [];
  await page.route(/\/api\/(orders\/\d+|returns\/\d+|ledger-entries\/\d+|customer-returns\/\d+)\/receipt$/, (route) => {
    read.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.getByText('Show reversed').click();

  const returns = page.getByRole('table', { name: 'Returns' });
  const rowOf = (id: number) => returns.getByRole('row').filter({ hasText: `#${String(id).padStart(6, '0')}` });
  // Nothing on a reversed return, as with its other actions (Q66).
  await expect(rowOf(7).getByRole('button', { name: /^Print/ })).toHaveCount(0);
  await rowOf(6).getByRole('button', { name: 'Print money receipt' }).click();
  await expect.poll(() => read).toEqual(['/api/ledger-entries/13/receipt']);
  // No cash paid back: the return's own paper (Q166). Read afresh: the refused print above has left.
  await page.reload();
  await rowOf(5).getByRole('button', { name: 'Print money receipt' }).click();
  await expect.poll(() => read).toEqual(['/api/ledger-entries/13/receipt', '/api/returns/5/receipt']);
  await page.reload();
  // A return of a visit: its own part, and the visit's one paper beside it, as on the returns list.
  await rowOf(8).getByRole('button', { name: 'Print money receipt' }).click();
  await expect
    .poll(() => read)
    .toEqual(['/api/ledger-entries/13/receipt', '/api/returns/5/receipt', '/api/ledger-entries/15/receipt']);
  await page.reload();
  await rowOf(8).getByRole('button', { name: 'Print the combined return receipt' }).click();
  await expect
    .poll(() => read)
    .toEqual([
      '/api/ledger-entries/13/receipt',
      '/api/returns/5/receipt',
      '/api/ledger-entries/15/receipt',
      '/api/customer-returns/4/receipt',
    ]);
});

test('Q137: on a phone, a money card with nothing to offer shows no empty Actions row (Q66)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOrder(page, {
    ...ACTIVE,
    ledgerEntries: [
      ...ACTIVE.ledgerEntries,
      {
        ...PAYMENT,
        id: 14,
        type: 'PAYMENT_REVERSAL',
        source: 'PAYMENT_DELETE',
        reversesEntryId: 11,
        canReverse: false,
      },
    ],
  });

  const money = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Transactions', exact: true }) });
  await expect(money.getByRole('button', { name: 'Print money receipt' })).toHaveCount(1);
  // The desktop table's header stays in the page, hidden; a card's label would be visible.
  await expect(money.getByText('Actions', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('Q139: the transactions print all together, in place (Q140), when there is something to print', async ({
  page,
  context,
}) => {
  await openOrder(page);
  const transactions = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Transactions', exact: true }) });
  await Promise.all([
    page.waitForRequest(/\/api\/orders\/9\/transactions-receipt$/),
    transactions.getByRole('button', { name: 'Print all' }).click(),
  ]);
  expect(context.pages()).toHaveLength(1);
});

test('Q139: an order without a payment or a refund offers no Print all', async ({ page }) => {
  await openOrder(page, { ...ACTIVE, ledgerEntries: [] });
  await expect(page.getByText('No transactions yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print all' })).toHaveCount(0);
});

test('without the permissions, the money actions stay away', async ({ page }) => {
  const viewer: MeDto = {
    ...ADMIN,
    id: 2,
    role: 'EMPLOYEE',
    permissions: ['orders.view', 'customers.view', 'drivers.view', 'items.view'],
  };
  await openOrder(page, ACTIVE, viewer);
  for (const name of ['Record return', 'Record payment', 'Edit return']) {
    await expect(page.getByRole('link', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Delete return' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete payment' })).toHaveCount(0);
});

test('a settled cash order has nothing to pay, but still records a return of what the customer holds (Q175)', async ({
  page,
}) => {
  await openOrder(page, {
    ...ACTIVE,
    paymentType: 'CASH',
    status: 'SETTLED',
    owed: 0,
    outQuantityTotal: 0,
    ledgerEntries: [],
  });

  await expect(page.getByRole('link', { name: 'Record return' })).toHaveAttribute('href', /\/returns\/new\?orderId=9$/);
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(0);
});

for (const [width, layout] of [
  [1280, 'table'],
  [390, 'cards'],
] as const) {
  test(`a corrected return names its replacement as a link to it (${layout})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const replacement: ReturnDto = { ...RETURN, id: 6, replacesReturnId: 5 };
    const old: ReturnDto = {
      ...RETURN,
      reversed: true,
      reversalKind: 'EDIT',
      replacedByReturnId: 6,
      canReverse: false,
    };
    // Newest first: the corrected return heads the list and its replacement is last, below eight others, out
    // of view until the link is followed.
    const between = [11, 12, 13, 14, 15, 16, 17, 18].map((id) => ({ ...RETURN, id }));
    await openOrder(page, { ...ACTIVE, returns: [replacement, ...between, old] });

    await page.getByRole('radio', { name: 'Show reversed' }).click();
    // The corrected return is faded, after its fade-in has settled (motion writes the opacity inline).
    await expect(page.locator('[data-anchor="return-5"]').locator('visible=true')).toHaveCSS('opacity', '0.6');
    const target = page.locator('[data-anchor="return-6"]').locator('visible=true');
    await expect(target).toHaveCount(1);
    const link = page.getByRole('button', { name: 'Replaced by return #6' });
    await link.scrollIntoViewIfNeeded();
    await expect(target).not.toBeInViewport();
    await link.click();

    await expect(target).toBeInViewport();
  });
}

test('returns read as a table: a row per return, its items line by line with their counts', async ({ page }) => {
  const other = { ...ITEM_REF, id: 6, name: 'Half pallet' };
  const two: ReturnDto = {
    ...RETURN,
    id: 7,
    notes: 'Two broken',
    cashRefund: 5_000,
    lines: [
      { ...(RETURN.lines[0] as ReturnDto['lines'][number]), acceptedQuantity: 12 },
      {
        ...(RETURN.lines[0] as ReturnDto['lines'][number]),
        id: 2,
        orderLineId: 22,
        item: other,
        acceptedQuantity: 3,
        damagedQuantity: 2,
        damagedRefund: 1_500,
      },
    ],
  };
  await openOrder(page, { ...ACTIVE, returns: [RETURN, two] });

  const table = page.getByRole('table', { name: 'Returns' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Date',
    'Item',
    'Accepted',
    'Damaged',
    'Damage refund',
    'Refund due',
    'Paid back in cash',
    'Note',
    'By',
    'Actions',
  ]);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  // Newest first; each item on its own line, in the same place in every column.
  const newest = rows.first();
  await expect(newest.getByRole('cell').nth(0)).toContainText('#000007');
  await expect(newest.getByRole('cell').nth(1).locator('li')).toHaveText([ITEM_REF.name, 'Half pallet']);
  await expect(newest.getByRole('cell').nth(2).locator('li')).toHaveText(['12', '3']);
  await expect(newest.getByRole('cell').nth(3).locator('li')).toHaveText(['0', '2']);
  await expect(newest.getByRole('cell').nth(4).locator('li')).toHaveText(['—', '1,500 IQD']);
  await expect(newest.getByRole('cell').nth(6)).toHaveText('5,000 IQD');
  await expect(newest.getByRole('cell').nth(7)).toHaveText('Two broken');
});

test('without a damage refund on any return, the table has no column for it', async ({ page }) => {
  await openOrder(page);

  const table = page.getByRole('table', { name: 'Returns' });
  await expect(table.getByRole('columnheader', { name: 'Refund due' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Damage refund' })).toHaveCount(0);
});

test('Q143: buttons, links, menu items and choices show the hand; a disabled button does not', async ({ page }) => {
  const replacement: ReturnDto = { ...RETURN, id: 6, replacesReturnId: 5 };
  const old: ReturnDto = { ...RETURN, reversed: true, reversalKind: 'EDIT', replacedByReturnId: 6, canReverse: false };
  await openOrder(page, { ...ACTIVE, returns: [old, replacement] });
  const cursor = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).cursor);

  expect(await cursor(page.getByRole('button', { name: 'Print receipt' }).first())).toBe('pointer');
  expect(await cursor(page.getByRole('button', { name: 'Delete return' }))).toBe('pointer');
  expect(await cursor(page.getByRole('link', { name: 'Record return' }))).toBe('pointer');
  expect(await cursor(page.getByRole('radio', { name: 'Show reversed' }))).toBe('pointer');
  await page.getByRole('button', { name: 'Language' }).click();
  expect(await cursor(page.getByRole('menuitem', { name: 'English' }))).toBe('pointer');
  await page.keyboard.press('Escape');

  // cmdk and sonner write data-disabled="false" on an enabled item; only another value means disabled.
  const probe = async (value: string) =>
    page.evaluate((disabled) => {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.setAttribute('data-disabled', disabled);
      document.body.append(option);
      const result = getComputedStyle(option).cursor;
      option.remove();
      return result;
    }, value);
  expect(await probe('false')).toBe('pointer');
  expect(await probe('true')).not.toBe('pointer');

  const print = page.getByRole('button', { name: 'Print receipt' }).first();
  await print.evaluate((element) => element.setAttribute('disabled', ''));
  expect(await cursor(print)).not.toBe('pointer');
});
