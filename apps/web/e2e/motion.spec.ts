import { expect, test, type Page } from './fixtures';
import { ADMIN, DRIVER, mockApi } from './mock-api';

/** The user menu: a dropdown every signed-in page has. */
async function openUserMenu(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: ADMIN.displayName }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('motion (§7.14)', () => {
  test('menus, popovers and selects fade and zoom in over 150 ms', async ({ page }) => {
    await mockApi(page, ADMIN, 'en');
    const menu = await openUserMenu(page);
    const style = await menu.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        duration: computed.animationDuration,
        scale: computed.getPropertyValue('--tw-enter-scale').trim(),
        opacity: computed.getPropertyValue('--tw-enter-opacity').trim(),
      };
    });
    expect(style).toEqual({ duration: '0.15s', scale: '.95', opacity: '0' });
  });

  test('with reduced motion asked for, CSS animations and transitions all but vanish', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page, ADMIN, 'en');
    const menu = await openUserMenu(page);
    const style = await menu.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { duration: computed.animationDuration, iterations: computed.animationIterationCount };
    });
    expect(style).toEqual({ duration: '1e-05s', iterations: '1' });
    const transition = await page
      .locator('aside a')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition.split(', ').every((value) => value === '1e-05s' || value === '0s')).toBe(true);
  });
});

test('buttons press in to 98 %, whether a button of their own or wrapping a link', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const pressed = async (target: ReturnType<Page['locator']>) => {
    const box = await target.boundingBox();
    if (!box) throw new Error('not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try {
      return await expect
        .poll(() =>
          target.evaluate((el) => {
            const { transform, scale } = getComputedStyle(el);
            const matrix = /^matrix\(([-\d.]+)/.exec(transform);
            return Number(matrix ? matrix[1] : scale === 'none' ? 1 : scale.split(' ')[0]);
          }),
        )
        .toBeCloseTo(0.98, 2);
    } finally {
      await page.mouse.up();
    }
  };

  // A button wrapping a link (asChild).
  await pressed(page.getByRole('link', { name: 'New order' }));
  // A button of its own.
  await page.goto('/reports/stock');
  await pressed(page.getByRole('button', { name: 'Print' }));
  // Hover changes colour only: no transform or layout transitions riding along.
  expect(
    await page.getByRole('button', { name: 'Print' }).evaluate((el) => getComputedStyle(el).transitionProperty),
  ).not.toContain('all');
});

test('a dialog fades and scales in, and leaves with an exit animation before it unmounts', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/customers/3');
  await page
    .locator('main header button')
    .filter({ has: page.locator('svg.lucide-archive') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // motion drives it: the values it animates sit inline on the element, settled at their end state.
  await expect.poll(() => dialog.evaluate((el) => el.style.opacity)).toBe('1');
  expect(await dialog.evaluate((el) => el.style.transform)).toMatch(/^(none|)$/);

  await page.keyboard.press('Escape');
  // Still there for its exit, fading out, then gone.
  expect(await dialog.evaluate((el) => Number(el.style.opacity || '1'))).toBeGreaterThan(0);
  await expect(dialog).toHaveCount(0);
});

test('the navigation sheet slides in from the reading start: the right in Kurdish', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
  const sample = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const id = setInterval(() => {
          const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
          if (sheet?.style.transform) seen.push(sheet.style.transform);
        }, 16);
        setTimeout(() => {
          clearInterval(id);
          resolve(seen);
        }, 600);
        document.querySelector<HTMLElement>('header button[aria-haspopup="dialog"]')?.click();
      }),
  );
  // Starting off-screen on the right (a positive x), then settling at 0.
  expect(
    sample.some((transform) => /translateX\((\d{2,}|\d+\.\d+)(%|px)\)/.test(transform) && !transform.includes('-')),
  ).toBe(true);
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
});

/** Samples an element's inline animated style every frame for a moment after `act`. */
async function sampleStyles(page: Page, selector: string, act: () => Promise<void>): Promise<string[]> {
  await page.evaluate((sel) => {
    const seen: string[] = [];
    (window as unknown as { __samples: string[] }).__samples = seen;
    const id = setInterval(() => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.style.opacity || el.style.transform) seen.push(`${el.style.opacity}|${el.style.transform}`);
      }
    }, 10);
    setTimeout(() => clearInterval(id), 900);
  }, selector);
  await act();
  await page.waitForTimeout(950);
  return page.evaluate(() => (window as unknown as { __samples: string[] }).__samples);
}

test('a new page fades in and slides from the reading start, without waiting on the old one', async ({ page }) => {
  await mockApi(page, ADMIN, 'ckb');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
  // Only the wrapper of the page navigated to: the dashboard's own entry could still be running.
  const samples = await sampleStyles(page, '[data-slot="page-transition"][data-route-id="/_app/orders/"]', () =>
    page.locator('aside nav a[href="/orders"]').click(),
  );

  const [opacity = '', transform = ''] = (samples[0] ?? '').split('|');
  expect(Number(opacity)).toBeLessThan(1);
  // It slides 8 px toward the reading start: from the left in Kurdish, so it starts at a negative x.
  expect(transform).toMatch(/translateX\(-\d/);
  await expect(page.locator('[data-slot="page-transition"]')).toHaveCount(1);
});

test('list rows fade in when the page of a short list changes, and a long list does not animate', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  // The next page holds other drivers: rows that enter, not the same rows re-rendered.
  await page.route(/\/api\/drivers\?.*page=2/, (route) =>
    route.fulfill({
      json: { items: [{ ...DRIVER, id: 77, name: 'Another driver' }], page: 2, pageSize: 25, total: 40 },
    }),
  );
  await page.goto('/drivers');
  await expect(page.getByRole('table')).toBeVisible();
  const short = await sampleStyles(page, 'tbody tr', () => page.getByRole('button', { name: 'Next' }).click());
  expect(short.some((sample) => Number(sample.split('|')[0]) < 1)).toBe(true);

  const DRIVER_ROWS = Array.from({ length: 60 }, (_, index) => ({
    id: 100 + index,
    name: `Driver ${index}`,
    phone: '07701234567',
    carNumber: 'Erbil 22 A 12345',
    archivedAt: null,
    version: 1,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:00.000Z',
  }));
  await page.route(/\/api\/drivers(\?.*)?$/, (route) => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    const items = DRIVER_ROWS.map((row) => (second ? { ...row, id: row.id + 1000 } : row));
    return route.fulfill({ json: { items, page: second ? 2 : 1, pageSize: 100, total: 120 } });
  });
  await page.goto('/drivers?pageSize=100');
  await expect(page.getByRole('row', { name: /Driver 59/ })).toBeVisible();
  const long = await sampleStyles(page, 'tbody tr', () => page.getByRole('button', { name: 'Next' }).click());
  expect(long).toEqual([]);
});

test('the bottom summary bar stays on the bottom edge while a daily flow slides in', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __bottoms: number[] }).__bottoms = seen;
    const id = setInterval(() => {
      const bar = document.querySelector<HTMLElement>('[data-slot="summary-bar"]');
      if (bar) seen.push(Math.round(bar.getBoundingClientRect().bottom));
    }, 5);
    setTimeout(() => clearInterval(id), 2500);
  });
  await page.getByRole('link', { name: 'New order' }).click();
  await page.waitForTimeout(2600);
  const bottoms = await page.evaluate(() => (window as unknown as { __bottoms: number[] }).__bottoms);
  expect(bottoms.length).toBeGreaterThan(0);
  expect([...new Set(bottoms)]).toEqual([844]);
});

test('a closing confirmation keeps its words while it fades out', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/drivers');
  await page
    .getByRole('row', { name: new RegExp(DRIVER.name) })
    .getByRole('button', { name: /Archive/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(DRIVER.name);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __titles: string[] }).__titles = seen;
    const id = setInterval(() => {
      const title = document.querySelector('[data-slot="dialog-title"]');
      if (title) seen.push(title.textContent ?? '');
    }, 5);
    setTimeout(() => clearInterval(id), 600);
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const titles = await page.evaluate(() => (window as unknown as { __titles: string[] }).__titles);
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.filter((title) => !title.includes(DRIVER.name))).toEqual([]);
});

test('a form dialog mounted only while open still fades out when it closes', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/drivers');
  await page.getByRole('button', { name: /New driver/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __exit: string[] }).__exit = seen;
    const id = setInterval(() => {
      const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
      seen.push(dialog ? getComputedStyle(dialog).opacity : 'gone');
    }, 5);
    setTimeout(() => clearInterval(id), 600);
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(650);
  const samples = await page.evaluate(() => (window as unknown as { __exit: string[] }).__exit);
  // Before it is gone, it is seen partway through fading.
  expect(samples.some((sample) => sample !== 'gone' && Number(sample) > 0 && Number(sample) < 1)).toBe(true);
});
