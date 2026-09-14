import { expect, test } from './fixtures';
import { ADMIN, ORDER, mockApi } from './mock-api';

/**
 * A record refetched in the background — the tab regains focus after someone else changed it — must not wipe what the
 * user is typing; a save on the stale version meets the version-conflict dialog instead.
 */
test('coming back to a half-edited order keeps what was typed', async ({ page }) => {
  await page.clock.install();
  await mockApi(page, ADMIN, 'en');
  let reads = 0;
  await page.route(/\/api\/orders\/9$/, (route) => {
    reads += 1;
    // Someone recorded a payment meanwhile: later reads carry a new version.
    return route.fulfill({ json: reads === 1 ? ORDER : { ...ORDER, version: ORDER.version + 1 } });
  });

  await page.goto('/orders/9/edit');
  const notes = page.getByLabel('Notes');
  await notes.fill('Deliver to the north gate');

  await page.clock.fastForward(60_000);
  await page.evaluate(() => {
    // TanStack Query's focus manager listens on window.
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(1_000);

  await expect(notes).toHaveValue('Deliver to the north gate');
});
