import type { CustomerReturnableDto, OrderLineDto, ReturnDto } from '@pallet/shared';
import { expect, test, type Page } from './fixtures';
import { ADMIN, ITEM, ORDER, RETURNABLE, mockApi } from './mock-api';

/** The longest name an item may have (200 characters), as a real one would read. */
const LONG_NAME = 'Heavy duty hardwood pallet, double deck, for the cement and steel works of the north '
  .repeat(3)
  .slice(0, 200);

const LONG_LINE: OrderLineDto = {
  ...(ORDER.lines[0] as OrderLineDto),
  id: 77,
  item: { ...(ORDER.lines[0] as OrderLineDto).item, id: 77, name: LONG_NAME },
};

async function openReturns(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await mockApi(page, ADMIN, 'en');
  const returnable: CustomerReturnableDto = {
    ...RETURNABLE,
    orders: RETURNABLE.orders.map((order, index) =>
      index === 0 ? { ...order, lines: [...order.lines, LONG_LINE] } : order,
    ),
  };
  await page.route(/\/api\/customers\/3\/returnable$/, (route) => route.fulfill({ json: returnable }));
  await page.goto('/returns/new?customerId=3');
}

/** How many lines a box of text takes, from its height and its line height. */
const linesOf = (page: Page, text: string) =>
  page.getByText(text.slice(0, 40)).evaluate((element) => {
    const box = element.closest('button, span') ?? element;
    const lineHeight = Number.parseFloat(getComputedStyle(box).lineHeight);
    return Math.round(box.getBoundingClientRect().height / lineHeight);
  });

for (const [device, width] of [
  ['a phone', 390],
  ['an upright iPad', 820],
] as const) {
  test(`Q162: on ${device} the return's calculation is in the page, under the customer`, async ({ page }) => {
    await openReturns(page, width);

    const card = page.getByRole('region', { name: 'Summary' });
    await expect(card).toBeVisible();
    // Fixed rows, the cash among them: it never grows or shrinks above the row being typed in.
    const rows = ['Pallets coming back', 'Refund due', 'Owed before', 'Owed after', 'Still out after'];
    for (const label of [...rows, 'Compensation assessed', 'Cash refund']) await expect(card).toContainText(label);
    const height = (await card.boundingBox())?.height;
    await page.getByRole('button', { name: 'All', exact: true }).first().click();
    await expect(card.getByText('Cash refund').locator('..').locator('dd')).not.toHaveText(/^0\b/);
    expect((await card.boundingBox())?.height).toBe(height);
    await expect(card.getByRole('list')).toHaveCount(0);
    // Above the items, so it is read before the counts are typed.
    const cardTop = (await card.boundingBox())?.y ?? Infinity;
    const firstItemTop = (await page.getByRole('button', { name: 'One more' }).first().boundingBox())?.y ?? 0;
    expect(cardTop).toBeLessThan(firstItemTop);
    // The side panel is not shown here; the bar keeps the one figure and the button.
    await expect(page.getByRole('complementary', { name: 'Summary' })).toBeHidden();
  });

  test(`Q163: on ${device} a 200-character item name stays within two lines`, async ({ page }) => {
    await openReturns(page, width);

    await expect(page.getByText(LONG_NAME.slice(0, 40))).toBeVisible();
    expect(await linesOf(page, LONG_NAME)).toBeLessThanOrEqual(2);
    // The whole name is still there for a pointer and a screen reader, and a tap shows it on a touch screen.
    const name = page.getByRole('button', { name: LONG_NAME });
    await expect(name).toHaveAttribute('title', LONG_NAME);
    await name.click();
    await expect(name).toHaveAttribute('aria-expanded', 'true');
    expect(await linesOf(page, LONG_NAME)).toBeGreaterThan(2);
    await name.click();
    expect(await linesOf(page, LONG_NAME)).toBeLessThanOrEqual(2);
  });

  test(`Q162: on ${device} an order's return form shows its calculation in the page too`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockApi(page, ADMIN, 'en');
    await page.goto('/returns/new?orderId=9');

    const card = page.getByRole('region', { name: 'Summary' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Owed after');
    await expect(card).toContainText('Cash refund');
    await expect(page.getByRole('complementary', { name: 'Summary' })).toBeHidden();
  });
}

test('Q162: on a desktop the calculation stays in the side panel alone', async ({ page }) => {
  await openReturns(page, 1280);

  await expect(page.getByRole('complementary', { name: 'Summary' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Summary' })).toBeHidden();
});

test('Q163: a name with no space to break at still fits a phone, in the item list and on an order', async ({
  page,
}) => {
  // A code-like name, one unbroken run of 120 characters: nothing to wrap at, so only the cut keeps it in.
  const unbroken = 'EURO-1200x800-HEAVYDUTY-DOUBLEDECK-'.repeat(4).slice(0, 120);
  await page.setViewportSize({ width: 390, height: 900 });
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/items(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [{ ...ITEM, name: unbroken }], page: 1, pageSize: 25, total: 1 } }),
  );
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({
      json: { ...ORDER, lines: ORDER.lines.map((line) => ({ ...line, item: { ...line.item, name: unbroken } })) },
    }),
  );

  for (const path of ['/items', '/orders/9']) {
    await page.goto(path);
    await expect(page.locator('bdi:visible', { hasText: unbroken.slice(0, 20) }).first()).toBeVisible();
    const { scroll, width } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: window.innerWidth,
    }));
    expect(scroll, path).toBeLessThanOrEqual(width);
  }
});

/** The longest note an order or a return may carry (1,000 characters), in words. */
const LONG_NOTE = 'Deliver to the second gate; the site manager signs for the pallets on arrival. '
  .repeat(13)
  .slice(0, 1000);

const LONG_RETURN: ReturnDto = {
  id: 22,
  orderId: ORDER.id,
  orderNumber: ORDER.orderNumber,
  date: '2026-09-12',
  notes: LONG_NOTE,
  refundDue: 10_000,
  owedBefore: 0,
  cashRefund: 10_000,
  lines: [
    {
      id: 1,
      orderLineId: (ORDER.lines[0] as OrderLineDto).id,
      item: (ORDER.lines[0] as OrderLineDto).item,
      acceptedQuantity: 10,
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
  createdAt: '2026-09-12T08:00:00.000Z',
  createdBy: { id: 1, username: 'admin', displayName: 'Admin' },
};

/** How many lines the visible copy of a note takes. */
const notes = (page: Page) => page.locator('button[title]:visible', { hasText: LONG_NOTE.slice(0, 30) });
const noteLines = (page: Page) =>
  notes(page)
    .locator('> span')
    .evaluateAll((boxes) =>
      boxes.map((box) =>
        Math.round(box.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(box).lineHeight)),
      ),
    );

for (const [device, width] of [
  ['a phone', 390],
  ['a desktop', 1280],
] as const) {
  test(`Q165: on ${device} the order's note is titled, and its and a return's note take two lines at most`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockApi(page, ADMIN, 'en');
    await page.route(/\/api\/orders\/9$/, (route) =>
      route.fulfill({ json: { ...ORDER, notes: LONG_NOTE, returns: [LONG_RETURN] } }),
    );
    await page.goto('/orders/9');

    await expect(page.getByText('Notes', { exact: true })).toBeVisible();
    // The order's note and the return's: both shown, each cut at two lines, each whole in its title.
    await expect.poll(async () => (await noteLines(page)).length).toBe(2);
    for (const lines of await noteLines(page)) expect(lines).toBeLessThanOrEqual(2);
    await expect(page.locator(`button[title="${LONG_NOTE}"]:visible`)).toHaveCount(2);
    // Not every reader has an Edit to open, nor a pointer: a tap shows a note whole, another cuts it again.
    await notes(page).first().click();
    expect((await noteLines(page))[0]).toBeGreaterThan(2);
    await notes(page).first().click();
    expect((await noteLines(page))[0]).toBeLessThanOrEqual(2);
  });

  test(`Q163, Q165: on ${device} a name or note with no space to break at never widens the page`, async ({ page }) => {
    const unbroken = 'EURO-1200x800-HEAVYDUTY-DOUBLEDECK-'.repeat(4).slice(0, 120);
    await page.setViewportSize({ width, height: 1000 });
    await mockApi(page, ADMIN, 'en');
    await page.route(/\/api\/orders\/9$/, (route) =>
      route.fulfill({
        json: {
          ...ORDER,
          notes: unbroken,
          lines: ORDER.lines.map((line) => ({ ...line, item: { ...line.item, name: unbroken } })),
          returns: [{ ...LONG_RETURN, notes: unbroken }],
        },
      }),
    );
    await page.goto('/orders/9');
    await expect(page.locator('bdi:visible', { hasText: unbroken.slice(0, 20) }).first()).toBeVisible();
    // Neither the page nor a table's own scroll box grows wider than it is: the text breaks anywhere instead.
    const overflow = await page.evaluate(() => [
      document.documentElement.scrollWidth - window.innerWidth,
      ...[...document.querySelectorAll<HTMLElement>('[data-slot="table-container"]')]
        .filter((box) => box.offsetParent !== null)
        .map((box) => box.scrollWidth - box.clientWidth),
    ]);
    for (const extra of overflow) expect(extra).toBeLessThanOrEqual(1);
  });
}
