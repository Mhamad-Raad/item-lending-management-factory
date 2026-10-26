import type { LedgerEntryDto, OrderDetailDto, ReturnDto, ReturnResultDto } from '@pallet/shared';
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';

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
  customerReturnId: null,
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
/** Text as read, without the invisible isolation marks around amounts in a sentence. */
const plain = (text: string | null) => (text ?? '').replace(/[\u2066-\u2069]/g, '');
/** The summary's figure for a label, matched whole: "0 IQD" must not pass for "101,000 IQD". */
const figure = (page: Page, label: string) => summary(page).getByText(label).locator('..').locator('dd');
const exactly = (text: string) => new RegExp(`^\\P{N}*${text}\\P{N}*$`, 'u');
const row = (page: Page) => page.getByRole('group', { name: new RegExp(ITEM_REF.name.slice(0, 12)) });
/** The saved dialog (Q166): the flow waits on it, and goes to the order once it is closed. */
async function closeSaved(page: Page) {
  const saved = page.getByRole('dialog', { name: 'Return recorded' });
  await expect(saved).toBeVisible();
  await expect(page).toHaveURL(/\/returns\/new/);
  await saved.getByRole('button', { name: 'Close' }).first().click();
}

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
  await closeSaved(page);
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
  await expect(row(page).getByRole('alert').filter({ hasText: '100' })).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();

  await row(page).getByLabel('Accepted').fill('98');
  await expect(refund).toBeEnabled();
  await refund.fill('2001');

  // Over its maximum the refund is refused as it is typed, like a count over what is out (Q146).
  await expect(row(page).getByRole('alert').filter({ hasText: '2,000' })).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
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

  await closeSaved(page);
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

test('Q141: more than is out is refused as it is typed and prices nothing', async ({ page }) => {
  const { sent } = await mockReturns(page, CASH);
  await page.goto('/returns/new?orderId=9');

  const accepted = row(page).getByLabel('Accepted');
  const damaged = row(page).getByLabel('Damaged');
  await accepted.fill('101');

  await expect(row(page).getByRole('alert').filter({ hasText: 'At most 100 are out' })).toBeVisible();
  await expect(accepted).toHaveAttribute('aria-invalid', 'true');
  await expect(figure(page, 'Refund due')).toHaveText(exactly('0 IQD'));
  await expect(figure(page, 'Still out after')).toHaveText(exactly('100'));
  await expect(summary(page)).not.toContainText('Hand the customer');

  // Accepted and damaged together count against what is out.
  await accepted.fill('99');
  await expect(row(page).getByRole('alert')).toHaveCount(0);
  await expect(summary(page)).toContainText('Hand the customer 99,000 IQD now');
  await damaged.fill('2');
  await expect(row(page).getByRole('alert').filter({ hasText: 'At most 100 are out' })).toBeVisible();
  await expect(damaged).toHaveAttribute('aria-invalid', 'true');
  await expect(summary(page)).not.toContainText('Hand the customer');

  // Nothing over what is out can be sent: Record return is off until the row is fixed.
  const record = summary(page).getByRole('button', { name: 'Record return' });
  await expect(record).toBeDisabled();
  expect(sent).toHaveLength(0);

  await damaged.fill('1');
  await expect(row(page).getByRole('alert')).toHaveCount(0);
  await expect(record).toBeEnabled();
  await expect(figure(page, 'Still out after')).toHaveText(exactly('0'));
  await expect(summary(page)).toContainText('Hand the customer 99,000 IQD now');
});

test('Q141: while one row is over, the others price but nothing is to be handed over', async ({ page }) => {
  const other = { ...LINE, id: 22, item: { ...ITEM_REF, id: 6, name: 'Half pallet' } };
  // Paid in full for both lines, so whatever comes back is paid out.
  await mockReturns(page, {
    ...CASH,
    lines: [LINE, other],
    depositTotal: 200_000,
    outValue: 200_000,
    outQuantityTotal: 200,
    paymentsNet: 200_000,
    held: 200_000,
    ledgerEntries: [{ ...PAYMENT, type: 'PAYMENT', source: 'ORDER_CREATE', isAutomatic: true, amount: 200_000 }],
  });
  await page.goto('/returns/new?orderId=9');

  await page.getByRole('group', { name: 'Half pallet' }).getByLabel('Accepted').fill('10');
  await expect(summary(page)).toContainText('Hand the customer 10,000 IQD now');
  await row(page).getByLabel('Accepted').fill('101');

  await expect(figure(page, 'Refund due')).toHaveText(exactly('10,000 IQD'));
  await expect(summary(page)).not.toContainText('Hand the customer');
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
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
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
  // Over what is out now, the row prices nothing (Q141); within it, it prices on its own line.
  await expect(figure(page, 'Refund due')).toHaveText(exactly('0 IQD'));
  await half.getByLabel('Accepted').fill('40');
  await expect(half.getByRole('alert')).toHaveCount(0);
  await expect(figure(page, 'Refund due')).toHaveText(exactly('40,000 IQD'));
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

  await closeSaved(page);
  await expect(page).toHaveURL(/\/orders\/9$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.flashed)).toBeUndefined();
});

test('Q137, Q166: a return that pays cash back offers the refund’s receipt in its dialog', async ({
  page,
  context,
}) => {
  await mockReturns(page, CASH);
  const refunded: OrderDetailDto = {
    ...CASH,
    ledgerEntries: [
      ...CASH.ledgerEntries,
      // Another return's refund on either side of this one's: the receipt offered is this return's, not the first
      // refund nor the newest.
      { ...PAYMENT, id: 12, type: 'REFUND', source: 'RETURN_CREATE', amount: 1_000, returnId: 5 },
      { ...PAYMENT, id: 13, type: 'REFUND', source: 'RETURN_CREATE', amount: 100_000, returnId: 6 },
      { ...PAYMENT, id: 14, type: 'REFUND', source: 'RETURN_EDIT', amount: 2_000, returnId: 7 },
    ],
  };
  await page.route(/\/api\/orders\/9\/returns$/, (route) =>
    route.fulfill({ status: 201, json: { returnId: 6, order: refunded } satisfies ReturnResultDto }),
  );

  await page.goto('/returns/new?orderId=9');
  await page.getByRole('button', { name: 'Everything returned accepted' }).click();
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  // Printed in place (Q140) from the dialog, which stays: the refund's receipt is read, and no tab opens.
  const saved = page.getByRole('dialog', { name: 'Return recorded' });
  const print = saved.getByRole('button', { name: 'Print money receipt' });
  await expect(print).toBeFocused();
  await Promise.all([page.waitForRequest(/\/api\/ledger-entries\/13\/receipt$/), print.click()]);
  expect(context.pages()).toHaveLength(1);
  await expect(saved).toBeVisible();
  await closeSaved(page);
  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('Q166: a return that pays nothing back offers its own return receipt in its dialog', async ({ page }) => {
  await mockReturns(page, LENT);
  const read: string[] = [];
  await page.route(/\/api\/(orders\/\d+|returns\/\d+|ledger-entries\/\d+)\/receipt$/, (route) => {
    read.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto('/returns/new?orderId=9');
  await row(page).getByLabel('Accepted').fill('50');
  await summary(page).getByRole('button', { name: 'Record return' }).click();

  // No refund, so no money receipt: the return's own paper, in the same design (Q166).
  const saved = page.getByRole('dialog', { name: 'Return recorded' });
  const print = saved.getByRole('button', { name: 'Print money receipt' });
  await expect(print).toBeFocused();
  await print.click();
  await expect.poll(() => read).toEqual(['/api/returns/6/receipt']);
  await closeSaved(page);
  await expect(page).toHaveURL(/\/orders\/9$/);
});

test('Q146: the damage refund reads as money and says what it does with the deposit', async ({ page }) => {
  await mockReturns(page, LENT);
  await page.goto('/returns/new?orderId=9');

  const refund = row(page).getByLabel('Damage refund');
  // The currency sits inside the box: an amount, not a count.
  await expect(refund.locator('..')).toContainText('IQD');
  await expect(row(page).getByText(/Of their .* deposit/)).toHaveCount(0);

  await row(page).getByLabel('Damaged').fill('2');
  const split = row(page).getByText(/Of their .* deposit/);
  await expect
    .poll(async () => plain(await split.textContent()))
    .toBe('Of their 2,000 IQD deposit, 0 IQD is refunded and 2,000 IQD is kept for the damage.');
  await expect(refund).toHaveAccessibleDescription(/Of their \W?2,000 IQD\W? deposit/);

  await refund.fill('500');
  await expect
    .poll(async () => plain(await split.textContent()))
    .toBe('Of their 2,000 IQD deposit, 500 IQD is refunded and 1,500 IQD is kept for the damage.');
  await expect(figure(page, 'Refund due')).toHaveText(exactly('500 IQD'));
  await expect(figure(page, 'Compensation assessed')).toHaveText(exactly('1,500 IQD'));

  // Over the deposit, the error replaces the split at once, prices nothing, and nothing can be sent.
  await refund.fill('2001');
  await expect(row(page).getByRole('alert').filter({ hasText: '2,000' })).toBeVisible();
  await expect(split).toHaveCount(0);
  await expect(figure(page, 'Refund due')).toHaveText(exactly('0 IQD'));
  await expect(summary(page).getByRole('button', { name: 'Record return' })).toBeDisabled();
  // Back within it, the error goes and the split returns.
  await refund.fill('2000');
  await expect(row(page).getByRole('alert')).toHaveCount(0);
  await expect(split).toBeVisible();
  // A row over what is out explains nothing: it prices nothing.
  await row(page).getByLabel('Accepted').fill('99');
  await expect(split).toHaveCount(0);
});

test('Q156: "All accepted" on an order counts the rest as accepted and keeps the damaged pallets typed', async ({
  page,
}) => {
  await mockReturns(page, LENT);
  await page.goto('/returns/new?orderId=9');
  await row(page).getByLabel('Damaged').fill('2');
  await row(page).getByLabel('Damage refund').fill('500');

  await row(page).getByRole('button', { name: 'All accepted' }).click();

  await expect(row(page).getByLabel('Accepted')).toHaveValue('98');
  await expect(row(page).getByLabel('Damaged')).toHaveValue('2');
  await expect(row(page).getByLabel('Damage refund')).toHaveValue('500');
});
