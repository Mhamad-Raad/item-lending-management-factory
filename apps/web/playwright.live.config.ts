import { defineConfig, devices } from '@playwright/test';
import { LIVE_ADMIN, LIVE_API_PORT, LIVE_WEB_PORT } from './e2e-live/accounts';

/**
 * The live end-to-end suite (§14.6 E1–E8, Q63): the production web build against the built API and a real
 * PostgreSQL test database, reset and seeded with the deterministic demo data before the run. The mocked suite
 * (`playwright.config.ts`, `e2e/`) stays for everything a real API cannot stage cheaply.
 *
 * Tests run one at a time: they share one database, and the flows change it.
 */
export default defineConfig({
  testDir: './e2e-live',
  outputDir: './test-results-live',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  // E6 baselines are rendered on the CI runner. A run there compares against the committed ones; one that lacks a
  // baseline writes it, fails that test (Playwright's rule for a missing baseline) and uploads the images as the
  // `e6-screenshots` artifact to commit. Locally nothing is written unless `--update-snapshots` is passed.
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  use: {
    baseURL: `http://localhost:${LIVE_WEB_PORT}`,
    locale: 'ckb',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e-live/serve.mjs',
      url: `http://127.0.0.1:${LIVE_API_PORT}/api/health`,
      // Locally a stack already started on these dedicated ports is reused (fast reruns, not reset); CI always
      // starts its own, from an emptied and seeded database.
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      env: {
        LIVE_API_PORT: String(LIVE_API_PORT),
        LIVE_ADMIN_USERNAME: LIVE_ADMIN.username,
        LIVE_ADMIN_DISPLAY_NAME: LIVE_ADMIN.displayName,
        LIVE_ADMIN_PASSWORD: LIVE_ADMIN.password,
      },
    },
    {
      command: `pnpm exec vite preview --port ${LIVE_WEB_PORT} --strictPort`,
      url: `http://localhost:${LIVE_WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PALLET_API_ORIGIN: `http://127.0.0.1:${LIVE_API_PORT}` },
    },
  ],
});
