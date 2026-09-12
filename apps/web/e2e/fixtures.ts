import { test as base } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

/**
 * Every test starts with the API sealed off: a request it does not mock is answered 404 here instead
 * of reaching the preview server's proxy, which forwards `/api` to whatever runs on port 3000 — a
 * developer's own API, where a test's fake token earns a 401 and ends its session. Routes a test adds
 * afterwards take precedence over this one.
 */
export const test = base.extend<{ sealApi: void }>({
  sealApi: [
    async ({ page }, use) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({ status: 404, json: { error: { code: 'ROUTE_NOT_FOUND', details: {} } } }),
      );
      await use();
    },
    { auto: true },
  ],
});
