import type { LedgerEntryDto, OrderDetailDto, OrderListItemDto, ReturnDto, ReturnResultDto } from '@pallet/shared';
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { ADMIN, CUSTOMER, ORDER, mockApi } from './mock-api';

const ITEM_REF = ORDER.lines[0]?.item ?? { id: 5, name: 'Pallet', imageUrl: null, archived: false };
const LINE = {
  id: 21,
  item: ITEM_REF,
  quantity: 100,
  unitDeposit: 1_000,
  lineTotal: 100_000,
  returnedAccepted: 0,
  returnedDamaged: 0,
  outQuantity: 100,
};
const PAYMENT = ORDER.ledgerEntries[0] as LedgerEntryDto;

/** §7.4.2's example: LENT 100 × 1,000 with 40,000 paid, every pallet out. */
const LENT: OrderDetailDto = {
  ...ORDER,
  paymentType: 'LENT',
  depositTotal: 100_000,
  paymentsNet: 40_000,
  owed: 60_000,
  outValue: 100_000,
  held: 40_000,
  outQuantityTotal: 100,
  lines: [LINE],
  returns: [],
  ledgerEntries: [{ ...PAYMENT, amount: 40_000 }],
};

/** A cash order already paid in full: whatever comes back is paid out. */
const CASH: OrderDetailDto = {
  ...LENT,
  paymentType: 'CASH',
  paymentsNet: 100_000,
  owed: 0,
  held: 100_000,
  ledgerEntries: [{ ...PAYMENT, type: 'PAYMENT', source: 'ORDER_CREATE', isAutomatic: true, amount: 100_000 }],
};

/** CASH with return #5 of 50 accepted, refunded 50,000 (U2). */
const RETURNED: ReturnDto = {
  id: 5,
  orderId: 9,
  orderNumber: ORDER.orderNumber,
  date: '2026-09-11',
  notes: 'First count',
  refundDue: 50_000,
  owedBefore: 0,
  cashRefund: 50_000,
  lines: [
    {
      id: 1,
      orderLineId: 21,
      item: ITEM_REF,
      acceptedQuantity: 50,
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
const CASH_RETURNED: OrderDetailDto = {
  ...CASH,
  creditsTotal: 50_000,
  refundsNet: 50_000,
  outQuantityTotal: 50,
  outValue: 50_000,
  held: 50_000,
  lines: [{ ...LINE, returnedAccepted: 50, outQuantity: 50 }],
  returns: [RETURNED],
  ledgerEntries: [
    ...CASH.ledgerEntries,
    { ...PAYMENT, id: 12, type: 'REFUND', source: 'RETURN_CREATE', amount: 50_000, returnId: 5 },
  ],
};

async function mockReturns(page: Page, order: OrderDetailDto) {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: order }));
  const sent: { url: string; body: unknown; key?: string }[] = [];
  const answer = (route: Route) => {
    sent.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    const result: ReturnResultDto = { returnId: 6, order };
    return route.fulfill({ status: 201, json: result });
  };
  await page.route(/\/api\/orders\/9\/returns$/, answer);
  await page.route(/\/api\/returns\/5\/replace$/, answer);
  return { sent };
}

const summary = (page: Page) => page.getByRole('complementary', { name: 'Summary' });
const row = (page: Page) => page.getByRole('group', { name: new RegExp(ITEM_REF.name.slice(0, 12)) });

test('daily flow 2: accepted pallets credit what is owed, live, and the return lands on its order', async ({
  page,
}) => {
  const { sent } = await mockReturns(page, LENT);

  await page.goto('/returns/new?orderId=9');
  await expect(row(page)).toContainText('100');
  await row(page).getByLabel('Accepted').fill('50');

  await expect(summary(page).getByText('Refund due').locator('..')).toContainText('50,000');
  await expect(summary(page).getByText('Owed before').locator('..')).toContainText('60,000');
  await expect(summary(page).getByText('Owed after').locator('..')).toContainText('10,000');
  await expect(summary(page).getByText('Still out after').locator('..')).toContainText('50');
  await expect(summary(page)).toContainText('The customer still owes 10,000');

  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect(page).toHaveURL(/\/orders\/9$/);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toMatch(/\/api\/orders\/9\/returns$/);
  expect(sent[0]?.body).toEqual({
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    notes: null,
    lines: [{ orderLineId: 21, acceptedQuantity: 50, damagedQuantity: 0, damagedRefund: 0 }],
  });
  expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
});

test('a cash refund is called out: hand the customer the money now', async ({ page }) => {
  await mockReturns(page, CASH);

  await page.goto('/returns/new?orderId=9');
  await page.getByRole('button', { name: 'Everything returned accepted' }).click();

  await expect(row(page).getByLabel('Accepted')).toHaveValue('100');
  await expect(summary(page)).toContainText('Hand the customer 100,000 IQD now');
});

test('checks each row against the pallets out and the damage refund against its maximum', async ({ page }) => {
  await mockReturns(page, LENT);
  await page.goto('/returns/new?orderId=9');

  await summary(page).getByRole('button', { name: 'Record return' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter at least one returned pallet' })).toBeVisible();

  const refund = row(page).getByLabel('Damage refund');
  await expect(refund).toBeDisabled();
  await row(page).getByLabel('Accepted').fill('99');
  await row(page).getByLabel('Damaged').fill('2');
  await expect(refund).toBeEnabled();
  await refund.fill('2001');
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(row(page).getByRole('alert').filter({ hasText: '100' })).toBeVisible();
  await expect(row(page).getByRole('alert').filter({ hasText: '2,000' })).toBeVisible();
  await expect(page).toHaveURL(/\/returns\/new/);
});

test('editing a return starts from it, prices against the order without it, and replaces it', async ({ page }) => {
  const { sent } = await mockReturns(page, CASH_RETURNED);

  await page.goto('/returns/new?orderId=9&replaceReturnId=5');
  await expect(row(page).getByLabel('Accepted')).toHaveValue('50');
  // Without return #5 all 100 are out again and nothing is owed.
  await expect(row(page)).toContainText('100');
  await expect(page.getByLabel('Notes')).toHaveValue('First count');
  await row(page).getByLabel('Accepted').fill('40');

  await expect(summary(page)).toContainText('Hand the customer 40,000 IQD now');
  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();

  await expect(page).toHaveURL(/\/orders\/9$/);
  expect(sent[0]?.url).toMatch(/\/api\/returns\/5\/replace$/);
  expect(sent[0]?.key).toBeUndefined();
  expect(sent[0]?.body).toMatchObject({ notes: 'First count', lines: [{ orderLineId: 21, acceptedQuantity: 40 }] });
});

test('a return already corrected or deleted elsewhere sends the user back to its order', async ({ page }) => {
  await mockReturns(page, CASH_RETURNED);
  await page.route(/\/api\/returns\/5\/replace$/, (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'RETURN_ALREADY_REVERSED', details: { returnId: 5 } } } }),
  );

  await page.goto('/returns/new?orderId=9&replaceReturnId=5');
  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();

  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('without an order, the customer is picked and their orders with pallets out are offered', async ({ page }) => {
  await mockReturns(page, LENT);
  const row9: OrderListItemDto = { ...LENT };
  await page.route(/\/api\/orders\?/, (route) =>
    route.fulfill({
      json: {
        items: [row9, { ...row9, id: 10, orderNumber: 43 }, { ...row9, id: 11, orderNumber: 44, outQuantityTotal: 0 }],
        page: 1,
        pageSize: 100,
        total: 3,
      },
    }),
  );

  await page.goto('/returns/new');
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: new RegExp(CUSTOMER.name.slice(0, 20)) }).click();

  await expect(page.getByRole('button', { name: /#123456/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /#000044/ })).toHaveCount(0);
  await page.getByRole('button', { name: /#123456/ }).click();
  await expect(page).toHaveURL(/orderId=9/);
});

test('a return the server finds too large keeps the rows typed and marks the row', async ({ page }) => {
  await mockReturns(page, LENT);
  let refused = false;
  // Another return took 30 meanwhile: the reloaded order has moved on a version.
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({
      json: refused
        ? {
            ...LENT,
            version: LENT.version + 1,
            outQuantityTotal: 70,
            lines: [{ ...LINE, returnedAccepted: 30, outQuantity: 70 }],
          }
        : LENT,
    }),
  );
  await page.route(/\/api\/orders\/9\/returns$/, (route) => {
    refused = true;
    return route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'RETURN_EXCEEDS_OUT',
          details: { lines: [{ orderLineId: 21, requested: 80, outQuantity: 70 }] },
        },
      },
    });
  });

  await page.goto('/returns/new?orderId=9');
  await row(page).getByLabel('Accepted').fill('80');
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(row(page).getByRole('alert').filter({ hasText: '70' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(row(page).getByRole('alert').filter({ hasText: '70' })).toBeVisible();
  await expect(row(page).getByLabel('Accepted')).toHaveValue('80');
});

test('a cleared date is refused, not recorded as today', async ({ page }) => {
  const { sent } = await mockReturns(page, LENT);

  await page.goto('/returns/new?orderId=9');
  await row(page).getByLabel('Accepted').fill('5');
  await page.getByLabel('Date').fill('');
  await page.getByLabel('Date').blur();
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'This field is required' })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test('an order with nothing out offers no return form, only the way back to it', async ({ page }) => {
  await mockReturns(page, {
    ...LENT,
    status: 'SETTLED',
    outQuantityTotal: 0,
    lines: [{ ...LINE, returnedAccepted: 100, outQuantity: 0 }],
  });

  await page.goto('/returns/new?orderId=9');

  await expect(page.getByText('Nothing is out on this order')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the order' })).toHaveAttribute('href', '/orders/9');
});

test('a reloaded order with a line removed keeps each typed row on its own line', async ({ page }) => {
  const other = { ...LINE, id: 22, item: { ...ITEM_REF, id: 6, name: 'Half pallet' } };
  const twoLines: OrderDetailDto = { ...LENT, lines: [LINE, other] };
  await mockReturns(page, twoLines);
  let refused = false;
  // Meanwhile the first line was taken off the order; the reload has only the second.
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({
      json: refused
        ? { ...twoLines, version: twoLines.version + 1, lines: [{ ...other, returnedAccepted: 60, outQuantity: 40 }] }
        : twoLines,
    }),
  );
  await page.route(/\/api\/orders\/9\/returns$/, (route) => {
    refused = true;
    return route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'RETURN_EXCEEDS_OUT',
          details: { lines: [{ orderLineId: 22, requested: 50, outQuantity: 40 }] },
        },
      },
    });
  });

  await page.goto('/returns/new?orderId=9');
  const half = page.getByRole('group', { name: 'Half pallet' });
  await half.getByLabel('Accepted').fill('50');
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  await expect(page.locator('fieldset')).toHaveCount(1);
  await expect(half.getByLabel('Accepted')).toHaveValue('50');
  await expect(half.getByRole('alert').filter({ hasText: '40' })).toBeVisible();
  await expect(summary(page).getByText('Refund due').locator('..')).toContainText('50,000');
});

test('a saved correction goes to its order without first saying the return cannot be corrected', async ({ page }) => {
  await mockReturns(page, CASH_RETURNED);
  // After the save the order reloads with return #5 reversed, as the server leaves it.
  let saved = false;
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({ json: saved ? { ...CASH_RETURNED, returns: [{ ...RETURNED, reversed: true }] } : CASH_RETURNED }),
  );
  await page.route(/\/api\/returns\/5\/replace$/, async (route) => {
    saved = true;
    await route.fulfill({ status: 201, json: { returnId: 6, order: CASH_RETURNED } });
  });

  await page.goto('/returns/new?orderId=9&replaceReturnId=5');
  await expect(page.getByRole('link', { name: /#123456/ })).toBeVisible();
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.body.textContent?.includes('This return can no longer be corrected'))
        document.body.dataset.flashed = 'yes';
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await summary(page).getByRole('button', { name: 'Save the corrected return' }).click();

  await expect(page).toHaveURL(/\/orders\/9$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.flashed)).toBeUndefined();
});
