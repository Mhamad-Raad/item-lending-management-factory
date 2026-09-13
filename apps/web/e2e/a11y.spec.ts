import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { ADMIN, mockApi } from './mock-api';

/** The three daily flows (§7.4), opened on an order where one applies. */
const FLOWS = ['/orders/new', '/returns/new?orderId=9', '/payments/new?orderId=9'];

/**
 * Axe's findings once the page has settled. Entry fades can outlast their 300 ms while the machine is busy, and
 * a colour read halfway through one fails contrast that the settled page passes; so axe runs until two
 * consecutive reports agree.
 */
async function settledFindings(page: Page, analyze: () => Promise<string[]>): Promise<string[]> {
  let previous = await analyze();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(300);
    const current = await analyze();
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  return previous;
}

async function seriousViolations(page: Page): Promise<string[]> {
  return settledFindings(page, () => seriousViolationsNow(page));
}

async function seriousViolationsNow(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`,
      ),
    );
}

test.describe('accessibility of the daily flows (§15 M6: axe, 0 serious or critical)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const language of ['ckb', 'en'] as const) {
      test(`${language}, ${theme} theme`, async ({ page }) => {
        // Axe reads colours once the page has settled: no transitions or entry animations halfway.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await mockApi(page, ADMIN, language, theme);
        const problems: string[] = [];
        for (const flow of FLOWS) {
          await page.goto(flow);
          await expect(page.locator('main h1').first()).toBeVisible();
          await page.addStyleTag({
            content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
          });
          problems.push(...(await seriousViolations(page)).map((problem) => `${flow} ${problem}`));
          // And with the form's own errors showing, as after a submit with fields left empty.
          const submit = page.locator('main form button[type="submit"]').first();
          if ((await submit.count()) > 0 && (await submit.isEnabled())) {
            await submit.click();
            problems.push(...(await seriousViolations(page)).map((problem) => `${flow} (errors) ${problem}`));
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});

test('text keeps its contrast across the pages with badges, notices and tables, in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await mockApi(page, ADMIN, 'en', theme);
    for (const route of [
      '/',
      '/orders',
      '/orders/9',
      '/customers/3',
      '/items',
      '/items/5',
      '/reports/stock',
      '/history',
      '/users',
    ]) {
      await page.goto(route);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
      });
      const findings = await settledFindings(page, async () => {
        const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        return results.violations.flatMap((violation) =>
          violation.nodes.map((node) => `${node.target.join(' ')}: ${node.any[0]?.message ?? ''}`),
        );
      });
      problems.push(...findings.map((finding) => `${theme} ${route} ${finding}`));
    }
  }
  expect(problems).toEqual([]);
});
