import type { LedgerEntryDto, MeDto, OrderDetailDto, ReturnDto } from '@pallet/shared';
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

test('a settled cash order has nothing to return or pay', async ({ page }) => {
  await openOrder(page, {
    ...ACTIVE,
    paymentType: 'CASH',
    status: 'SETTLED',
    owed: 0,
    outQuantityTotal: 0,
    ledgerEntries: [],
  });

  await expect(page.getByRole('link', { name: 'Record return' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(0);
});

test('a corrected return names its replacement as a link to it', async ({ page }) => {
  const replacement: ReturnDto = { ...RETURN, id: 6, replacesReturnId: 5 };
  const old: ReturnDto = { ...RETURN, reversed: true, reversalKind: 'EDIT', replacedByReturnId: 6, canReverse: false };
  await openOrder(page, { ...ACTIVE, returns: [old, replacement] });

  await page.getByRole('radio', { name: 'Show reversed' }).click();
  await page.getByRole('link', { name: 'Replaced by return #6' }).click();

  await expect(page.locator('#return-6')).toBeInViewport();
});
