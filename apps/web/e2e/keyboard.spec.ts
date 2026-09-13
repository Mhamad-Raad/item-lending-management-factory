import { expect, test } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

test.describe('keyboard (§7.15)', () => {
  test('a destructive confirmation opens on Cancel, closes on Esc, and hands focus back to its button', async ({
    page,
  }) => {
    await mockApi(page, ADMIN, 'en');
    await page.goto('/customers/3');
    const archive = page
      .locator('main header button')
      .filter({ has: page.locator('svg.lucide-archive') })
      .first();
    await archive.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(archive).toBeFocused();
  });

  test('a form dialog opens on its first field, keeps Tab inside, and Enter submits it', async ({ page }) => {
    await mockApi(page, ADMIN, 'en');
    let created = false;
    await page.route(/\/api\/drivers$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created = true;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.goto('/drivers');
    await page.getByRole('button', { name: /New driver/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name')).toBeFocused();

    for (let press = 0; press < 12; press += 1) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await dialog.getByLabel('Name').fill('Dana Kamal');
    await dialog.getByLabel('Phone').fill('07701112233');
    await dialog.getByLabel('Car number').fill('Erbil 22 A 12345');
    await dialog.getByLabel('Car number').press('Enter');
    await expect.poll(() => created).toBe(true);
  });

  test('the skip link is the first stop, and no element jumps the tab order', async ({ page }) => {
    await mockApi(page, ADMIN, 'en');
    await page.goto('/orders');
    await expect(page.locator('main h1')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    expect(await page.locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count()).toBe(0);
  });
});

test('every stop on the way through a page shows the solid focus ring', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  const problems: string[] = [];
  for (const route of ['/', '/orders', '/orders/new', '/orders/9', '/customers/3', '/reports/stock', '/account']) {
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    // The ring is read at its final colour, not partway through the element's colour transition.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const seen = new Set<string>();
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // The ring colour as the browser serialises it, read from a probe painted with the token.
        const probe = document.createElement('span');
        probe.style.color = 'var(--ring)';
        document.body.append(probe);
        const ring = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(el);
        // A ring layer at full strength and at least 2 px wide, or a solid outline of the same colour.
        const layers = style.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim());
        const ringLayer = layers.some((layer) => {
          const spread = /0px 0px 0px (\d+(?:\.\d+)?)px$/.exec(layer);
          return layer.startsWith(ring) && spread !== null && Number(spread[1]) >= 2;
        });
        const outline =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 && style.outlineColor === ring;
        const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
        return {
          label,
          ok: ringLayer || outline,
          found: `${style.boxShadow} | outline ${style.outlineStyle} ${style.outlineWidth}`,
        };
      });
      if (!stop || seen.has(stop.label)) continue;
      seen.add(stop.label);
      if (!stop.ok) problems.push(`${route} ${stop.label}`);
    }
  }
  expect(problems).toEqual([]);
});

test('Enter opens a menu from its button, as Space and the arrow keys do', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const trigger = page.locator('aside').getByRole('button', { name: ADMIN.displayName });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  // And it stays open: not opened by one event and closed again by the next.
  await page.waitForTimeout(500);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
});

test('a field with an error still shows the solid focus ring when it has focus', async ({ page }) => {
  await mockApi(page, ADMIN, 'en');
  await page.goto('/drivers');
  await page.getByRole('button', { name: /New driver/ }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Name');
  await expect(name).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(name).toBeFocused();
  const solid = await name.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ring)';
    document.body.append(probe);
    const ring = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el)
      .boxShadow.split(/,(?![^(]*\))/)
      .some((layer) => layer.trim().startsWith(ring) && /0px 0px 0px [2-9]/.test(layer));
  });
  expect(solid).toBe(true);
});
