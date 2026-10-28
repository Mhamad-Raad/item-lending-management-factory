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
  withOrder: null,
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

// Since Q175 the one-order form is a correction's alone: its rules are checked there.
test('Q141: a correction over what is out is refused as typed, prices nothing and cannot be saved', async ({
  page,
}) => {
  const { sent } = await mockReturns(page, CASH_RETURNED);
  await page.goto('/returns/new?orderId=9&replaceReturnId=5');
  await expect(row(page).getByLabel('Accepted')).toHaveValue('50');

  const accepted = row(page).getByLabel('Accepted');
  const damaged = row(page).getByLabel('Damaged');
  await accepted.fill('101');
  await expect(row(page).getByRole('alert').filter({ hasText: 'At most 100 are out' })).toBeVisible();
  await expect(accepted).toHaveAttribute('aria-invalid', 'true');
  await expect(figure(page, 'Refund due')).toHaveText(exactly('0 IQD'));
  await expect(summary(page)).not.toContainText('Hand the customer');

  // Accepted and damaged together count against what is out.
  await accepted.fill('99');
  await damaged.fill('2');
  await expect(row(page).getByRole('alert').filter({ hasText: 'At most 100 are out' })).toBeVisible();
  const save = summary(page).getByRole('button', { name: 'Save the corrected return' });
  await expect(save).toBeDisabled();

  await damaged.fill('1');
  await expect(row(page).getByRole('alert')).toHaveCount(0);
  await expect(save).toBeEnabled();
  expect(sent).toHaveLength(0);
});

test('Q146: a correction refuses a damage refund over its maximum as it is typed', async ({ page }) => {
  await mockReturns(page, CASH_RETURNED);
  await page.goto('/returns/new?orderId=9&replaceReturnId=5');
  await expect(row(page).getByLabel('Accepted')).toHaveValue('50');

  await row(page).getByLabel('Accepted').fill('98');
  await row(page).getByLabel('Damaged').fill('2');
  const refund = row(page).getByLabel('Damage refund');
  await expect(refund).toBeEnabled();
  await refund.fill('2001');
  await expect(row(page).getByRole('alert').filter({ hasText: '2,000' })).toBeVisible();
  await expect(summary(page).getByRole('button', { name: 'Save the corrected return' })).toBeDisabled();
});
