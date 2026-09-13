import { expect, test, type Page } from './fixtures';
import { ADMIN, ITEM, mockApi } from './mock-api';

/**
 * §7.15: every screen is usable at 390 px with no horizontal page scroll. Each route renders with
 * long names and large amounts, as an admin (who sees every navigation entry) in Kurdish Sorani.
 * The receipt is left out: printing happens from a desktop, on A4.
 */
const ROUTES = [
  '/',
  '/orders',
  '/orders/new',
  '/orders/9',
  '/orders/9/edit',
  '/customers',
  '/customers/new',
  '/customers/3',
  '/customers/3/edit',
  '/items',
  '/items/new',
  '/items/5',
  '/items/5/edit',
  '/drivers',
  '/history',
  '/users',
  '/users/new',
  '/users/2',
  '/settings',
  '/account',
];

test.use({ viewport: { width: 390, height: 844 } });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
}

/**
 * §7.15 target sizes: below `md` every control is at least `h-10` (40 px). Checkboxes, radios and switches are
 * left out — their visible label is part of the target — and so is a file input, which stays hidden
 * behind its own button.
 */
async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button:not([role="switch"]):not([role="checkbox"]):not([role="radio"]), [data-slot="button"], [role="combobox"], [role="tab"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea',
      ),
    ]
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'))
      .filter((element) => element.getBoundingClientRect().height < 40)
      .map(
        (element) =>
          `${element.tagName} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().height)}px`,
      ),
  );
  expect(small).toEqual([]);
}

for (const path of ROUTES) {
  test(`${path} fits a 390 px screen`, async ({ page }) => {
    await mockApi(page);

    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
}

test('the sign-in page fits a 390 px screen', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel('ناوی بەکارهێنەر')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('on a phone, every navigation entry and signing out are reachable from the menu', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/drivers');
  await expect(page.getByRole('heading', { level: 1, name: 'Drivers' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Drivers');

  await page.getByRole('button', { name: 'Open menu' }).click();

  const menu = page.getByRole('dialog');
  for (const name of ['Dashboard', 'Orders', 'Customers', 'Items', 'Drivers', 'History', 'Users', 'Settings']) {
    await expect(menu.getByRole('link', { name })).toBeInViewport();
  }
  await expect(menu.getByRole('link', { name: 'Drivers' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: 'Customers' }).click();
  await expect(page).toHaveURL(/\/customers(\?|$)/);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('banner')).toContainText('Customers');

  await page.getByRole('button', { name: 'Hawre Abdulrahman Mohammed' }).click();
  await expect(page.getByRole('menuitem', { name: 'My account' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
});

test('the skip link is the first tab stop and moves focus to the content', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/drivers');
  await expect(page.getByRole('heading', { level: 1, name: 'Drivers' })).toBeVisible();

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');

  await expect(page.locator('main#main')).toBeFocused();
});

test('on a phone, the orders list shows results first and keeps its filters one tap away', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/orders?')) asked.push(new URL(request.url()).search);
  });
  await page.goto('/orders');

  await expect(page.getByRole('list', { name: 'Orders' }).getByRole('listitem').first()).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('combobox', { name: 'Payment', exact: true })).toBeHidden();

  await page.getByRole('button', { name: 'Filters' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByRole('combobox', { name: 'Payment', exact: true }).click();
  await page.getByRole('option', { name: 'Cash' }).click();
  await sheet.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByPlaceholder('Search').last().fill('Kurdistan');
  await page.getByRole('option', { name: /Kurdistan Cement/ }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filters' })).toContainText('2');
  await expect
    .poll(() => asked.some((search) => search.includes('paymentType=CASH') && search.includes('customerId=3')))
    .toBe(true);
});

test('turning the phone does not reopen a filter sheet it closed by widening', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  // The wide layout has rendered once the button is gone (the sheet's own pickers would match too early).
  await expect(page.getByRole('button', { name: 'Filters' })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden();
});

test('on a phone, the customer summary sits two cards to a row', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/customers/3');

  const card = (label: string) =>
    page.locator('[data-slot="card"]').filter({ has: page.getByText(label, { exact: true }) });
  await expect(card('Owed')).toBeVisible();
  const [valueOut, owed, held] = await Promise.all(
    ['Value out', 'Owed', 'Deposit held'].map((label) => card(label).boundingBox()),
  );

  // Side by side, and the next pair starts a row below them.
  expect(Math.abs((valueOut?.y ?? 0) - (owed?.y ?? 1))).toBeLessThan(1);
  expect(held?.y).toBeGreaterThan((owed?.y ?? 0) + (owed?.height ?? 0));

  // Hundreds of millions of dinars still fit inside a half-width card.
  const spills = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="card-content"]')].flatMap((content) => {
      const box = content.getBoundingClientRect();
      const style = getComputedStyle(content);
      const [start, end] = [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)];
      return [...content.querySelectorAll('span')]
        .map((span) => span.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && (rect.left < start - 0.5 || rect.right > end + 0.5))
        .map(() => content.textContent?.slice(0, 40));
    }),
  );
  expect(spills).toEqual([]);
});

test('opening a record from its list shows the record, never a loading skeleton', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, ADMIN, 'en');
  // A detail answer a little slower than a click: without a loader the page would mount first and
  // show its skeleton. (Slower than the router's pending delay, a skeleton is the right answer.)
  await page.route(/\/api\/items\/5$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ json: ITEM });
  });
  await page.goto('/items');
  await expect(page.getByRole('link', { name: ITEM.name })).toBeVisible();
  // A skeleton in place of the record counts; the tabs below it may still load their own lists.
  await page.evaluate((name) => {
    new MutationObserver(() => {
      const skeleton = document.querySelector('main [data-slot="skeleton"]');
      if (skeleton && document.querySelector('main h1')?.textContent !== name)
        document.body.dataset.sawSkeleton = 'yes';
    }).observe(document.body, { childList: true, subtree: true });
  }, ITEM.name);

  await page.getByRole('link', { name: ITEM.name }).click();

  await expect(page.getByRole('heading', { level: 1, name: ITEM.name })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.sawSkeleton)).toBeUndefined();
});

test('a record that does not exist still shows its not-found state after the loader', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/items\/999$/, (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'ITEM_NOT_FOUND', details: { itemId: 999 } } } }),
  );

  await page.goto('/items/999');

  await expect(page.getByText('This record does not exist')).toBeVisible();
});

test('a failing record is fetched without the loader retrying, then reported by its page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, ADMIN, 'en');
  let attempts = 0;
  await page.route(/\/api\/items\/5$/, (route) => {
    attempts += 1;
    return route.fulfill({ status: 502, json: { error: { code: 'UNKNOWN_ERROR', details: {} } } });
  });
  await page.goto('/items');

  await page.getByRole('link', { name: ITEM.name }).click();

  // The list gives way at once — to the pending skeleton, then the record's page — rather than
  // standing still while the loader waits (the address changes at once either way).
  await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeHidden({ timeout: 3_000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 15_000 });
  // Counted, not timed, so a slow machine cannot fail it: the page's own query makes three attempts
  // (one and two retries); the loader, and the hover that preloaded it, add one each at most. A loader
  // inheriting the client's retries would add three of its own.
  expect(attempts).toBeLessThanOrEqual(5);
});

test('a slow record shows its skeleton while the list is left behind', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, ADMIN, 'en');
  await page.route(/\/api\/items\/5$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.fulfill({ json: ITEM });
  });
  await page.goto('/items');

  await page.getByRole('link', { name: ITEM.name }).click();

  await expect(page.locator('main [data-slot="skeleton"]').first()).toBeVisible({ timeout: 1_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeHidden();
});
