import type {
  ActivityEventDto,
  AuditLogDto,
  CustomerReturnReceiptDto,
  LedgerEntryDto,
  MeDto,
  MoneyReceiptDto,
} from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, AUDIT_ROW, CUSTOMER, ORDER, mockApi } from './mock-api';
import { catchFramePrints } from './receipt-frames';

const FACTORY = { name: 'Pallet Factory', phone: '07500000000', address: 'Erbil', logoUrl: null };
const PARTIES = { name: 'Kurdistan Cement', phone: '07501234567', address: 'Erbil' };
const CUSTOMER_REF = { id: CUSTOMER.id, name: CUSTOMER.name, phone: CUSTOMER.phone, archived: false };

/** A visit over three orders: 42,500 paid back, 30,000 still owed on the credit one (Q161). */
const VISIT: CustomerReturnReceiptDto = {
  customerReturnId: 5,
  receiptNumberDisplay: '000005',
  date: '2026-10-20',
  printedOn: '2026-10-24',
  owedBefore: 60_000,
  credit: 72_500,
  amount: 42_500,
  owedAfter: 30_000,
  note: null,
  recordedBy: { id: 1, username: 'admin', displayName: 'Admin' },
  reversedOn: null,
  allReversed: false,
  factory: FACTORY,
  customer: PARTIES,
};

/** This order's own part of it: its refund row, which belongs to visit 5. */
const REFUND: LedgerEntryDto = {
  id: 31,
  orderId: ORDER.id,
  orderNumber: ORDER.orderNumber,
  customer: CUSTOMER_REF,
  type: 'REFUND',
  source: 'RETURN_CREATE',
  amount: 40_000,
  date: '2026-10-20',
  effectiveDate: '2026-10-20',
  isAutomatic: false,
  returnId: 17,
  customerReturnId: 5,
  reversesEntryId: null,
  reversedByEntryId: null,
  isReversed: false,
  canReverse: false,
  note: null,
  createdAt: '2026-10-20T09:00:00.000Z',
  createdBy: { id: 1, username: 'admin', displayName: 'Admin' },
};

const OWN_PART: MoneyReceiptDto = {
  ledgerEntryId: 31,
  receiptNumberDisplay: '000031',
  kind: 'REFUND',
  date: '2026-10-20',
  printedOn: '2026-10-24',
  amount: 40_000,
  owedBefore: 0,
  credit: 40_000,
  owedAfter: 0,
  source: 'RETURN_CREATE',
  note: null,
  recordedBy: { id: 1, username: 'admin', displayName: 'Admin' },
  reversedOn: null,
  order: { id: ORDER.id, orderNumber: ORDER.orderNumber, orderNumberDisplay: '123456', date: ORDER.date },
  factory: FACTORY,
  customer: PARTIES,
};

/** Every receipt read, by its address; each answered with its paper. */
async function serveReceipts(page: Page): Promise<string[]> {
  const read: string[] = [];
  await page.route(/\/api\/customer-returns\/5\/receipt$/, (route) => {
    read.push('visit');
    return route.fulfill({ json: VISIT });
  });
  await page.route(/\/api\/ledger-entries\/31\/receipt$/, (route) => {
    read.push('own');
    return route.fulfill({ json: OWN_PART });
  });
  return read;
}

test('Q161: an order’s refund of a customer return prints its own part, and the visit’s one paper beside it', async ({
  page,
}) => {
  const printed = await catchFramePrints(page);
  await mockApi(page, ADMIN, 'en');
  const read = await serveReceipts(page);
  await page.route(/\/api\/orders\/9$/, (route) => route.fulfill({ json: { ...ORDER, ledgerEntries: [REFUND] } }));
  await page.goto('/orders/9');

  await page.getByRole('button', { name: 'Print money receipt' }).click();
  await expect.poll(async () => (await printed()).length).toBe(1);
  await page.getByRole('button', { name: 'Print the combined return receipt' }).click();
  await expect.poll(async () => (await printed()).length).toBe(2);
  expect(read).toEqual(['own', 'visit']);

  const [own, visit] = await printed();
  // The order's part names the order; the visit's paper names none, under a number of its own.
  expect(own).toContain('ژمارەی داواکاری');
  expect(visit).not.toContain('ژمارەی داواکاری');
  expect(visit?.match(/ژمارەی پسووڵەی گەڕاندنەوە: 000005/g)).toHaveLength(2);
  expect(visit).toContain('42,500');
  expect(visit).toContain('30,000');
});

test('Q161: a payment, or a refund of an order’s own return, has no combined receipt to offer', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({ json: { ...ORDER, ledgerEntries: [{ ...REFUND, customerReturnId: null }] } }),
  );
  await page.goto('/orders/9');

  await expect(page.getByRole('button', { name: 'Print money receipt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print the combined return receipt' })).toHaveCount(0);
});

test('Q161: the customer’s refunds print the visit’s one paper, the one the customer was given', async ({ page }) => {
  const printed = await catchFramePrints(page);
  await mockApi(page, ADMIN, 'en');
  const read = await serveReceipts(page);
  await page.route(/\/api\/customers\/3$/, (route) => route.fulfill({ json: CUSTOMER }));
  await page.route(/\/api\/ledger-entries\?/, (route) =>
    route.fulfill({ json: { items: [REFUND], page: 1, pageSize: 25, total: 1 } }),
  );
  await page.goto(`/customers/${CUSTOMER.id}`);
  await page.getByRole('tab', { name: 'Refunds' }).click();

  await expect(page.getByRole('button', { name: 'Print money receipt' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Print the combined return receipt' }).click();
  await expect.poll(async () => (await printed()).length).toBe(1);
  expect(read).toEqual(['visit']);
});

test('Q161: the receipt’s own page refuses a visit that paid nothing back, in Sorani', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/customer-returns\/5\/receipt$/, (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'CUSTOMER_RETURN_NO_RECEIPT', details: { customerReturnId: 5 } }, requestId: 'r' },
    }),
  );
  await page.goto('/print/customer-returns/5');

  await expect(page.getByText('لەم گەڕاندنەوەیەدا هیچ پارەیەک نەدراوەتەوە، بۆیە پسووڵەی نییە')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(0);
});

const VISIT_EVENT: ActivityEventDto = {
  kind: 'CUSTOMER_RETURN',
  at: '2026-10-20T09:00:00.000Z',
  date: '2026-10-20',
  orderId: null,
  orderNumber: null,
  customerReturnId: 5,
  orderCount: 3,
  customer: CUSTOMER_REF,
  quantity: 75,
  amount: 42_500,
  reversed: false,
  partlyReversed: false,
};

async function openDashboard(page: Page, user: MeDto, event: ActivityEventDto = VISIT_EVENT) {
  await mockApi(page, user, 'en');
  await page.route(/\/api\/dashboard$/, (route) => route.fulfill({ json: { recentActivity: [event] } }));
  await page.goto('/');
  return page.getByRole('list', { name: 'Recent activity' }).getByRole('listitem');
}

test('Q161: a customer return is one line on the dashboard, leading to its customer', async ({ page }) => {
  const activity = await openDashboard(page, ADMIN);

  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText('Customer return');
  await expect(activity.getByRole('link', { name: 'Orders: 3' })).toHaveAttribute('href', `/customers/${CUSTOMER.id}`);
  await expect(activity).toContainText('42,500');
  await expect(activity).toHaveCSS('cursor', 'pointer');
  // A press anywhere on the row follows its link, not just on the link.
  await activity.getByText(CUSTOMER.name).click();
  await expect(page).toHaveURL(`/customers/${CUSTOMER.id}`);
});

test('Q161: a customer return partly reversed since is flagged so, wholly reversed as reversed', async ({ page }) => {
  const partly = await openDashboard(page, ADMIN, { ...VISIT_EVENT, partlyReversed: true });
  await expect(partly).toContainText('Partly reversed');
  await expect(partly).not.toContainText('Reversed');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const whole = await openDashboard(page, ADMIN, { ...VISIT_EVENT, reversed: true });
  await expect(whole).toContainText('Reversed');
  await expect(whole).not.toContainText('Partly reversed');
});

test('Q161: without customers.view the line says how many orders, and offers nothing to press', async ({ page }) => {
  const activity = await openDashboard(page, {
    ...ADMIN,
    role: 'EMPLOYEE',
    permissions: ['orders.view'],
  });

  await expect(activity).toContainText('Orders: 3');
  await expect(activity.getByRole('link')).toHaveCount(0);
  await expect(activity).not.toHaveCSS('cursor', 'pointer');
});

test('Q161: a customer return’s history row names its orders and leads to its customer', async ({ page }) => {
  const row: AuditLogDto = {
    ...AUDIT_ROW,
    action: 'RETURN_CREATE',
    entityType: 'CUSTOMER_RETURN',
    entityId: '5',
    summaryKey: 'audit.summary.CUSTOMER_RETURN.RETURN_CREATE',
    summaryParams: {
      customerName: 'Kurdistan Cement',
      orders: 3,
      accepted: 75,
      damaged: 0,
      refundDue: 72_500,
      cashRefund: 42_500,
    },
    after: { id: 5, customerId: CUSTOMER.id, date: '2026-10-20', returns: [] },
  };
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/audit-logs(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [row], page: 1, pageSize: 50, total: 1 } }),
  );
  await page.goto('/history');

  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: '#5' })).toHaveAttribute('href', `/customers/${CUSTOMER.id}`);
  await expect(table).toContainText(
    // The name keeps its own direction inside the sentence (§7.11).
    'Return of \u2068Kurdistan Cement\u2069 (orders: 3): 75 accepted, 0 damaged, credit 72,500, cash refund 42,500',
  );
});
