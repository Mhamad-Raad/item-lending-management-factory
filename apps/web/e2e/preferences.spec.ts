import { expect, test } from './fixtures';
import { mockApi } from './mock-api';

/** E7 (§14.6): the language and the theme change the running page, and the receipt ignores the theme. */
test.describe('E7: language and theme switch', () => {
  test('switching to English flips the direction without a reload, and dark sets html.dark', async ({ page }) => {
    await mockApi(page, undefined, 'ckb', 'light');
    await page.goto('/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // A reload would wipe this marker.
    await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));

    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('radio', { name: 'Dark', exact: true }).check();
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    await page.getByRole('radio', { name: 'Light', exact: true }).check();
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);

    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });

  test('the receipt stays light when the app is dark', async ({ browser }) => {
    const bodyColours = async (theme: 'light' | 'dark', path: string) => {
      const page = await browser.newPage();
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await mockApi(page, undefined, 'en', theme);
      await page.addInitScript(() => {
        window.print = () => undefined;
      });
      await page.goto(path);
      await expect(page.locator(path.startsWith('/print') ? '.sheet' : 'h1').first()).toBeVisible();
      const colours = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, text: style.color };
      });
      return { page, colours };
    };

    const light = await bodyColours('light', '/print/orders/9');
    const dark = await bodyColours('dark', '/print/orders/9');

    await expect(dark.page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await dark.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    expect(dark.colours).toEqual(light.colours);
    await Promise.all([light.page.close(), dark.page.close()]);
  });
});
