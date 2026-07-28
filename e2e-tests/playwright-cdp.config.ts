// Adapted from paranext-core/e2e-tests/playwright-cdp.config.ts
import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the CDP (feature) test tier. These tests connect over CDP (port
 * 9223) to a running Platform.Bible instance with the interlinearizer extension loaded.
 *
 * `globalSetup` launches that instance automatically (with `--remote-debugging-port=9223`) and
 * `globalTeardown` shuts it down, so `npm run test:e2e:cdp` is self-contained — no manual `npm run
 * start:cdp` first. If the CDP port is already taken, the setup instead reuses the running instance
 * and leaves it up, so a developer iterating against a warm `npm run start:cdp` instance can point
 * Playwright at it directly (`npx playwright test --config e2e-tests/playwright-cdp.config.ts`).
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/smoke/**', '**/_example/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retries help on the never-reset shared instance only because each test self-heals leftover
  // modals at its start (ensureInterlinearizerOpenOnWeb → dismissLeftoverModals), so a retry lands
  // on a clean instance.
  retries: process.env.CI ? 2 : 1,
  // Every test in this tier drives the one shared instance, so an instance that comes up unusable
  // fails all of them — at a full `timeout` plus both retries each, which has burned 45 minutes of
  // CI for a single wedged startup. Stop after the first test exhausts its retries: when the
  // instance is the problem, the remaining tests only reconfirm it.
  maxFailures: process.env.CI ? 1 : 0,
  workers: 1,
  // Tier-specific report folder so a combined `npm run test:e2e` run doesn't overwrite the smoke
  // tier's report. `open: 'never'` keeps CI from auto-launching a browser.
  reporter: [['html', { outputFolder: 'playwright-report/cdp', open: 'never' }], ['list']],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './global-setup-cdp.ts',
  globalTeardown: './global-teardown-cdp.ts',
  outputDir: './test-results/cdp',
});
