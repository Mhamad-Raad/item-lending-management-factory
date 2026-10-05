import { expect, test, type Page } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

const MINUTE = 60_000;
const LAST_ACTIVITY = 'pallet.lastActivity.v1';

/**
 * A signed-in page whose clock the test moves, and the sign-outs it sends. The session is ended on the server
 * too (Q136), so each one is a `POST /api/auth/logout`.
 */
async function open(page: Page, path = '/'): Promise<{ signOuts: () => number; refreshes: () => number }> {
  await page.clock.install();
  await mockApi(page, ADMIN, 'en');
  let signOuts = 0;
  let refreshes = 0;
  await page.route('**/api/auth/logout', (route) => {
    signOuts += 1;
    return route.fulfill({ status: 204 });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/refresh')) refreshes += 1;
  });
  await page.goto(path);
  // The app has started — on its page, or on the login page it sent the browser to — before the clock is moved.
  await expect(page.locator('main')).toBeVisible();
  return { signOuts: () => signOuts, refreshes: () => refreshes };
}

const warning = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Are you still there?' });
const notice = 'You were signed out after 15 minutes without activity.';

test('fifteen idle minutes end the session, with a warning for the last one (Q136)', async ({ page }) => {
  const { signOuts } = await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.clock.fastForward(14 * MINUTE - 1_000);
  await expect(warning(page)).toHaveCount(0);

  await page.clock.fastForward(31_000);
  await expect(warning(page)).toContainText('Signing out in 30 s.');
  expect(signOuts()).toBe(0);

  await page.clock.fastForward(30_000);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByText(notice)).toBeVisible();
  expect(signOuts()).toBe(1);
  // Nothing of the last session is left to count: the login page does not sign anyone out again.
  await page.clock.fastForward(20 * MINUTE);
  expect(signOuts()).toBe(1);
});

/**
 * On the real clock, since a moved one holds back the frames a leaving dialog animates with: the session starts
 * with fourteen and a half idle minutes on record, so the warning is up as the page opens.
 */
async function openNearTheLimit(page: Page, secondsLeft: number): Promise<{ signOuts: () => number }> {
  await page.addInitScript(
    ([key, idle]) => {
      if (window.sessionStorage.getItem('seeded')) return;
      window.sessionStorage.setItem('seeded', '1');
      window.localStorage.setItem(key, String(Date.now() - idle));
    },
    [LAST_ACTIVITY, 15 * MINUTE - secondsLeft * 1_000] as const,
  );
  await mockApi(page, ADMIN, 'en');
  let signOuts = 0;
  await page.route('**/api/auth/logout', (route) => {
    signOuts += 1;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/orders');
  return { signOuts: () => signOuts };
}

test('answering the warning keeps the session; a pointer on its way to the button is not the answer', async ({
  page,
}) => {
  const { signOuts } = await openNearTheLimit(page, 30);
  await expect(warning(page)).toBeVisible();

  await page.mouse.move(40, 40);
  await page.mouse.move(60, 80);
  await page.waitForTimeout(1_200);
  await expect(warning(page)).toBeVisible();

  // The press itself answers, before the click is complete: the dialog is already leaving under the pointer.
  await warning(page).getByRole('button', { name: 'Stay signed in' }).click({ force: true });
  await expect(warning(page)).toHaveCount(0);
  const record = await page.evaluate((key) => Number(window.localStorage.getItem(key)), LAST_ACTIVITY);
  expect(Date.now() - record).toBeLessThan(10_000);
  await expect(page).toHaveURL(/\/orders/);
  expect(signOuts()).toBe(0);
});

test('a key answers the warning too', async ({ page }) => {
  await openNearTheLimit(page, 30);
  await expect(warning(page)).toBeVisible();

  await page.keyboard.press('Shift');

  await expect(warning(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/orders/);
});

test('unanswered, the warning goes with the session it warned about', async ({ page }) => {
  const { signOuts } = await openNearTheLimit(page, 3);
  await expect(warning(page)).toBeVisible();

  await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 10_000 });
  await expect(page.getByText(notice)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(signOuts()).toBe(1);
});

test('typing counts as being there, and no warning shows while someone works', async ({ page }) => {
  const { signOuts } = await open(page, '/customers/new');

  for (let round = 0; round < 3; round++) {
    await page.clock.fastForward(10 * MINUTE);
    await page.getByLabel('Name').pressSequentially('a');
  }

  await expect(warning(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/customers\/new/);
  expect(signOuts()).toBe(0);
});

test('an idle sign-out does not stop to ask about a half-typed form', async ({ page }) => {
  await open(page, '/customers/new');
  await page.getByLabel('Name').fill('Kurdistan Cement');

  await page.clock.fastForward(15 * MINUTE + 1_000);

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(notice)).toBeVisible();
  // The unsaved-changes question is for someone who is there to answer it.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Kurdistan Cement')).toHaveCount(0);
});

test('a browser opened again after the limit starts signed out, without using the old session', async ({ page }) => {
  await page.addInitScript(
    ([key, at]) => {
      // Once: the sign-in that follows writes its own record, which a reload must not put back.
      if (window.sessionStorage.getItem('seeded')) return;
      window.sessionStorage.setItem('seeded', '1');
      window.localStorage.setItem(key, String(at));
    },
    [LAST_ACTIVITY, Date.now() - 16 * MINUTE] as const,
  );
  const { signOuts, refreshes } = await open(page, '/orders');

  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByText(notice)).toBeVisible();
  expect(signOuts()).toBe(1);
  expect(refreshes()).toBe(0);
});

test('work in one tab keeps the other tabs of the browser signed in', async ({ context }) => {
  const reading = await context.newPage();
  const working = await context.newPage();
  await open(reading, '/orders');
  await open(working, '/customers/new');

  // One clock for the whole browser: twenty minutes pass in both tabs, with typing in one of them only.
  for (let round = 0; round < 2; round++) {
    await context.clock.fastForward(10 * MINUTE);
    await working.getByLabel('Name', { exact: true }).pressSequentially('a');
  }
  await context.clock.fastForward(1_000);

  await expect(reading).toHaveURL(/\/orders/);
  await expect(working).toHaveURL(/\/customers\/new/);
  await expect(warning(reading)).toHaveCount(0);

  // Left alone together, they end together.
  await context.clock.fastForward(15 * MINUTE);
  await expect(reading).toHaveURL(/\/login\?redirect=%2Forders/);
  await expect(working).toHaveURL(/\/login\?redirect=%2Fcustomers%2Fnew/);
});

/**
 * When a laptop wakes, every timer fires at once: the refresh that keeps a session alive and the check that ends an
 * idle one. The refresh must not win — its answer would sign the page back in after the sign-out.
 */
test('a refresh due at the same moment does not bring an idle session back', async ({ page }) => {
  const { signOuts, refreshes } = await open(page, '/orders');
  const atStart = refreshes();

  await page.clock.fastForward(40 * MINUTE);

  await expect(page).toHaveURL(/\/login\?redirect=%2Forders/);
  await expect(page.getByText(notice)).toBeVisible();
  expect(signOuts()).toBe(1);
  expect(refreshes()).toBe(atStart);
});

/**
 * The tabs of a browser share one session. When it is ended in one — signed out there, or idle there a moment
 * sooner — the record of the last activity goes with it, and every other tab follows at once: without a request of
 * its own, and without starting a new fifteen minutes on a session that no longer exists.
 */
test('a tab follows a sign-out made in another tab, even one nobody touched since it loaded', async ({ context }) => {
  const working = await context.newPage();
  await mockApi(working, ADMIN, 'en');
  await working.goto('/customers/new');
  await working.getByLabel('Name', { exact: true }).fill('Kurdistan Cement');

  // Opened beside it and left alone, like a receipt in its own tab.
  const untouched = await context.newPage();
  await mockApi(untouched, ADMIN, 'en');
  let signOuts = 0;
  await untouched.route('**/api/auth/logout', (route) => {
    signOuts += 1;
    return route.fulfill({ status: 204 });
  });
  await untouched.goto('/orders');
  await expect(untouched.locator('main')).toBeVisible();

  // What ending the session does in the tab that ends it.
  await working.evaluate((key) => window.localStorage.removeItem(key), LAST_ACTIVITY);

  await expect(untouched).toHaveURL(/\/login\?redirect=%2Forders/);
  expect(signOuts).toBe(0);
  expect(await untouched.evaluate((key) => window.localStorage.getItem(key), LAST_ACTIVITY)).toBeNull();
});

test('the screen is cleared at the limit, without waiting for the server to answer the sign-out', async ({ page }) => {
  await page.clock.install();
  await mockApi(page, ADMIN, 'en');
  let answered = false;
  await page.route('**/api/auth/logout', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    answered = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/customers/new');
  await page.getByLabel('Name', { exact: true }).fill('Kurdistan Cement');

  await page.clock.fastForward(15 * MINUTE + 1_000);

  await expect(page).toHaveURL(/\/login/, { timeout: 2_000 });
  await expect(page.getByText(notice)).toBeVisible();
  expect(answered).toBe(false);
  // Not heard from yet: a reload now must not use the cookie the server has not ended.
  expect(await page.evaluate(() => window.localStorage.getItem('pallet.signOutPending.v1'))).toBe('1');
});
