import type { Page } from './fixtures';

/**
 * Receipts printed in place (Q140) print from a frame of the page: there, `print()` records the paper's text on the
 * top page instead of opening the dialog. Returns a reader of what was printed, in order.
 */
export async function catchFramePrints(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    if (window.top === window) return;
    window.print = () => {
      const top = window.top as unknown as { framePrints?: string[] };
      (top.framePrints ??= []).push(document.body.textContent ?? '');
    };
  });
  return () => page.evaluate(() => (window as unknown as { framePrints?: string[] }).framePrints ?? []);
}
