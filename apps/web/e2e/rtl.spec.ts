import { expect, test, type Page } from './fixtures';
import { ADMIN, CUSTOMER, DRIVER, ITEM, ORDER, mockApi } from './mock-api';

const EMPLOYEE_NAME = 'Shilan Omer Rasul';
const NAMES = [ITEM.name, CUSTOMER.name, DRIVER.name, ADMIN.displayName, EMPLOYEE_NAME];

/**
 * The text nodes on the page holding one of `NAMES`, and which of them nothing isolates (§7.11, Q43): a
 * Latin name with neutral punctuation ("1200 × 800, heat treated") reorders inside right-to-left text
 * unless it sits in `<bdi>`, in an element that sets its own `dir="auto"`/`"ltr"`, or between the Unicode
 * isolate marks. An ancestor that merely repeats the page's `rtl` isolates nothing.
 */
async function namesOnPage(page: Page): Promise<{ found: number; loose: string[] }> {
  return page.evaluate((names) => {
    const loose: string[] = [];
    let found = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const name = names.find((candidate) => text.includes(candidate));
      if (!name) continue;
      found += 1;
      let isolated = text.includes(`⁨${name}⁩`);
      for (let el = node.parentElement; !isolated && el && el !== document.body; el = el.parentElement) {
        isolated = el.tagName === 'BDI' || ['auto', 'ltr'].includes(el.getAttribute('dir') ?? '');
      }
      if (!isolated) loose.push(`${node.parentElement?.tagName}: ${text.slice(0, 50)}`);
    }
    return { found, loose };
  }, NAMES);
}

test('the Kurdish app runs right to left, and mirrors the icons that point a way', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  await page.goto('/orders/9');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');

  // "Record return" carries Undo2: its arrow must point the other way in a right-to-left page.
  const undo = page.locator('main svg.lucide-undo-2').first();
  await expect(undo).toBeVisible();
  expect(await undo.evaluate((svg) => getComputedStyle(svg).scale)).toBe('-1 1');

  await mockApi(page, ADMIN, 'en');
  await page.goto('/orders/9');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(
    await page
      .locator('main svg.lucide-undo-2')
      .first()
      .evaluate((svg) => getComputedStyle(svg).scale),
  ).toBe('none');
});

test('names people typed keep their own direction on every page that shows them', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  const problems: string[] = [];
  for (const route of [
    '/',
    '/orders',
    '/orders/9',
    '/customers',
    '/customers/3',
    '/items',
    '/items/5',
    '/drivers',
    '/users',
    '/users/2',
    '/history',
    '/account',
    '/reports/positions?customerId=3',
    '/reports/purchases?itemId=5',
    '/reports/activity?customerId=3',
    '/reports/stock',
  ]) {
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByRole('status').or(page.locator('[data-slot="skeleton"]'))).toHaveCount(0);
    const { found, loose } = await namesOnPage(page);
    if (found === 0) problems.push(`${route}: no name found to check`);
    problems.push(...loose.map((entry) => `${route} ${entry}`));
  }
  expect(problems).toEqual([]);
});

test('names inside sentences keep their direction: banners and confirmations', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  await page.route(/\/api\/orders\/9$/, (route) =>
    route.fulfill({
      json: {
        ...ORDER,
        creditOverride: { by: { id: 1, displayName: ADMIN.displayName }, at: ORDER.createdAt },
      },
    }),
  );
  const problems: string[] = [];
  const check = async (where: string) => {
    const { found, loose } = await namesOnPage(page);
    if (found === 0) problems.push(`${where}: no name found to check`);
    problems.push(...loose.map((entry) => `${where} ${entry}`));
  };

  await page.goto('/orders/9');
  await expect(page.locator('main h1').first()).toBeVisible();
  await check('order with an override');

  for (const [route, opener] of [
    ['/customers/3', 'archive'],
    ['/items/5', 'archive'],
    ['/users/2', 'switch'],
    ['/users/2', 'logout'],
  ] as const) {
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    if (opener === 'switch') await page.getByRole('switch').first().click();
    else if (opener === 'logout')
      await page.locator('main button.bg-destructive, main [data-variant="destructive"]').last().click();
    else
      await page
        .locator('main header button')
        .filter({ has: page.locator('svg.lucide-archive') })
        .first()
        .click();
    await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toBeVisible();
    await check(`${route} ${opener} dialog`);
  }
  expect(problems).toEqual([]);
});

test('in the Kurdish menu and sidebar, a short Latin display name lines up with its role below it', async ({
  page,
}) => {
  // Short enough that the menu is wider than the name: the case where its own alignment shows.
  await mockApi(page, { ...ADMIN, displayName: 'Admin' }, 'ckb');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const rightEdges = async (scope: ReturnType<Page['locator']>) => {
    const [name, role] = await Promise.all([
      scope
        .locator('bdi', { hasText: 'Admin' })
        .first()
        .evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right;
        }),
      scope
        .locator('.text-muted-foreground')
        .first()
        .evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right;
        }),
    ]);
    return Math.abs(name - role);
  };

  const trigger = page.locator('aside').getByRole('button', { name: /Admin/ });
  // Right to left, both lines of text end at the same right edge.
  expect(await rightEdges(trigger)).toBeLessThan(2);
  await trigger.click();
  expect(await rightEdges(page.getByRole('menu').locator('.flex-col').first())).toBeLessThan(2);
});
