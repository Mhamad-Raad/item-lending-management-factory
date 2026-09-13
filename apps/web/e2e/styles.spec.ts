import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { ITEM, mockApi } from './mock-api';

const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  mustChangePassword: false,
  permissions: [],
};

/** The receipt's print styles belong to the receipt tab alone; the app never inherits its page grey. */
test('an app page does not wear the receipt styles', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('pallet.prefs.v1', JSON.stringify({ language: 'en' }));
  });
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      json: { accessToken: 'token', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user: ADMIN },
    }),
  );
  await page.route(/\/api\/drivers\?/, (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } }),
  );

  await page.goto('/drivers');
  await expect(page.getByRole('heading', { name: 'Drivers' })).toBeVisible();

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe('rgb(229, 229, 229)');
});

test.describe('typography and theme tokens (§7.12, §7.13)', () => {
  test('Kurdish and Arabic text gets the taller Arabic-script line height; English keeps 1.5', async ({ page }) => {
    for (const [language, ratio] of [
      ['ckb', 1.7],
      ['ar', 1.7],
      ['en', 1.5],
    ] as const) {
      await mockApi(page, undefined, language);
      await page.goto('/drivers');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Body copy in every size a page uses for it: plain text, and Tailwind's text-xs … text-lg,
      // which carry their own line heights.
      const measured = await page.evaluate(() =>
        ['', 'text-xs', 'text-sm', 'text-base', 'text-lg'].map((size) => {
          const probe = document.createElement('p');
          probe.className = size;
          probe.textContent = 'ناو';
          document.querySelector('main')?.append(probe);
          const style = getComputedStyle(probe);
          const ratio = Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 100) / 100;
          probe.remove();
          return ratio;
        }),
      );
      expect(measured, language).toEqual([ratio, ratio, ratio, ratio, ratio]);
    }
  });

  test('the dark theme tells the browser, so native controls and scrollbars are dark too', async ({ page }) => {
    await mockApi(page, undefined, 'en', 'dark');
    await page.goto('/drivers');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  });

  test('a page printed from the dark theme prints in the light palette', async ({ browser }) => {
    const backgroundIn = async (theme: 'light' | 'dark', media: 'screen' | 'print') => {
      const page = await browser.newPage();
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await mockApi(page, undefined, 'en', theme);
      await page.emulateMedia({ media });
      await page.goto('/drivers');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      return page;
    };
    // Compared with the same page printed from the light theme: paper has its own colours (§12.1's
    // white page), and the theme a user chose on screen must not change them.
    const light = await backgroundIn('light', 'print');
    // Text colour, not the background: print forces the page white whatever the theme.
    const lightText = await light.evaluate(() => getComputedStyle(document.body).color);
    const page = await backgroundIn('dark', 'print');
    // The theme writes its scheme inline on <html>; the print rule must still win over it.
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');

    expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(lightText);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    await Promise.all([light.close(), page.close()]);
  });

  test('a low-stock item is flagged in the warning colour', async ({ page }) => {
    await mockApi(page, undefined, 'en');
    await page.route(/\/api\/items\/5$/, (route) =>
      route.fulfill({ json: { ...ITEM, quantityOnHand: 10, minStock: 50, isLowStock: true } }),
    );
    await page.goto('/items/5');
    const badge = page.locator('[data-slot="badge"]').filter({ hasText: 'Low stock' }).first();
    await expect(badge).toBeVisible();

    expect(await tokenColours(badge, '--warning')).toMatchObject({ matches: true, defined: true });
    expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
  });

  test('an open order is marked in the info colour', async ({ page }) => {
    await mockApi(page, undefined, 'en');
    await page.goto('/orders');
    const badge = page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first();
    await expect(badge).toBeVisible();

    expect(await tokenColours(badge, '--info')).toMatchObject({ matches: true, defined: true });
    expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
  });
});

/** Whether `locator`'s text wears the colour token `name`, and whether the token exists at all. */
function tokenColours(locator: Locator, name: string): Promise<{ matches: boolean; defined: boolean }> {
  return locator.evaluate((element, token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token}, rgb(1, 2, 3))`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return { matches: getComputedStyle(element).color === colour, defined: colour !== 'rgb(1, 2, 3)' };
  }, name);
}

/**
 * WCAG contrast of `locator`'s text against what is painted behind it: its own and its ancestors'
 * backgrounds composited up to the first opaque one. Colours are read back through a canvas, so any
 * CSS colour syntax (oklch included) arrives as sRGB.
 */
function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no canvas');
    const rgba = (colour: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255, a / 255];
    };
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = rgba(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 1) break;
    }
    let behind: [number, number, number] = [1, 1, 1];
    for (const [r, g, b, a] of layers.reverse()) {
      behind = [r * a + behind[0] * (1 - a), g * a + behind[1] * (1 - a), b * a + behind[2] * (1 - a)];
    }
    const [fr, fg, fb, fa] = rgba(getComputedStyle(element).color);
    const text = [fr * fa + behind[0] * (1 - fa), fg * fa + behind[1] * (1 - fa), fb * fa + behind[2] * (1 - fa)];
    const luminance = (rgb: number[]) =>
      rgb
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index]!, 0);
    const [lighter, darker] = [luminance(text), luminance(behind)].sort((x, y) => y - x);
    return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
  });
}

test('an active user is marked in the success colour, readable in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await mockApi(page, undefined, 'en', theme);
    await page.goto('/users');
    const badge = page.locator('main [data-slot="badge"]').filter({ hasText: 'Active' }).first();
    await expect(badge).toBeVisible();
    await page.waitForTimeout(350);
    expect(await tokenColours(badge, '--success')).toMatchObject({ matches: true, defined: true });
    expect(await contrastOf(badge), theme).toBeGreaterThanOrEqual(4.5);
  }
});

test('the font-size steps scale the whole interface, controls included, without a reload (§7.12)', async ({ page }) => {
  await mockApi(page, undefined, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');
  const heading = page.locator('main h1');
  await expect(heading).toBeVisible();
  const measure = () =>
    page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).fontSize,
      control: document.querySelector<HTMLElement>('main [data-slot="button"]')?.getBoundingClientRect().height ?? 0,
    }));

  const steps: Record<string, { root: string; control: number }> = {};
  for (const [label, key] of [
    ['Small', 'sm'],
    ['Extra large', 'xl'],
    ['Normal', 'md'],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    steps[key] = await measure();
  }
  expect(steps.sm?.root).toBe('14px');
  expect(steps.md?.root).toBe('16px');
  expect(steps.xl?.root).toBe('20px');
  // A 2.25 rem control follows the root size: 31.5, 36 and 45 px.
  expect(steps.sm?.control).toBeCloseTo(31.5, 0);
  expect(steps.md?.control).toBeCloseTo(36, 0);
  expect(steps.xl?.control).toBeCloseTo(45, 0);
});

test('every field outline, pickers included, uses the field token at 3 : 1 (Q44)', async ({ page }) => {
  await mockApi(page, undefined, 'en');
  await page.goto('/orders/new');
  await expect(page.locator('main h1')).toBeVisible();
  const outlines = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--input)';
    document.body.append(probe);
    const input = getComputedStyle(probe).color;
    probe.remove();
    return [
      ...document.querySelectorAll<HTMLElement>(
        'main input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), main textarea, main [role="combobox"]',
      ),
    ]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        field: el.getAttribute('aria-label') ?? el.id ?? el.tagName,
        matches: getComputedStyle(el).borderTopColor === input,
      }));
  });
  expect(outlines.length).toBeGreaterThan(2);
  expect(outlines.filter((outline) => !outline.matches)).toEqual([]);
});
