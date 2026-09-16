import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** Q51: from `lg` the sidebar collapses to its icons, keeps every page reachable by name, and remembers the choice. */
test.describe('Q51: collapsible sidebar', () => {
  const width = (aside: Locator) => aside.evaluate((element) => element.getBoundingClientRect().width);

  test('collapses to icons with tooltips, and stays collapsed after a reload', async ({ page }) => {
    await mockApi(page, ADMIN, 'en');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const aside = page.locator('aside');
    const orders = aside.getByRole('link', { name: 'Orders' });
    await expect(aside).toHaveAttribute('data-state', 'expanded');
    await expect(orders).toContainText('Orders');
    expect(await width(aside)).toBe(256);

    await aside.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(aside).toHaveAttribute('data-state', 'collapsed');
    await expect.poll(() => width(aside)).toBe(64);
    // The name stays for screen readers, and a pointer reads it in a tooltip at the reading end.
    await expect(orders).toBeVisible();
    await expect(orders.locator('.sr-only')).toHaveText('Orders');
    await orders.hover();
    const tip = page.getByRole('tooltip', { name: 'Orders' });
    await expect(tip).toBeVisible();
    expect((await tip.boundingBox())!.x).toBeGreaterThan(64);
    // Group names are for screen readers alone.
    await expect(aside.getByText('Daily work')).toHaveClass(/sr-only/);
    // The content moves in behind the narrower sidebar.
    expect(await page.locator('main').evaluate((element) => element.getBoundingClientRect().x)).toBeLessThan(100);

    await orders.click();
    await expect(page).toHaveURL(/\/orders(\?|$)/);
    await expect(orders).toHaveAttribute('aria-current', 'page');

    await page.reload();
    await expect(aside).toHaveAttribute('data-state', 'collapsed');
    await expect(aside.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');

    await aside.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(aside).toHaveAttribute('data-state', 'expanded');
    await expect.poll(() => width(aside)).toBe(256);
    await expect(aside.getByText('Daily work')).toBeVisible();
  });

  test('right to left, the collapsed tooltip sits at the reading end and the user menu still opens', async ({
    page,
  }) => {
    await mockApi(page, ADMIN, 'ckb');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const aside = page.locator('aside');
    await aside.getByRole('button', { name: 'بچووککردنەوەی پێڕست' }).click();
    await expect(aside).toHaveAttribute('data-state', 'collapsed');
    await expect.poll(() => width(aside)).toBe(64);
    expect((await aside.boundingBox())!.x).toBe(1280 - 64);

    const orders = aside.getByRole('link', { name: 'داواکارییەکان' });
    await orders.hover();
    const tip = page.getByRole('tooltip', { name: 'داواکارییەکان' });
    await expect(tip).toBeVisible();
    const box = (await tip.boundingBox())!;
    expect(box.x + box.width).toBeLessThan(1280 - 64);

    await aside.getByRole('button', { name: ADMIN.displayName }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  });
});
