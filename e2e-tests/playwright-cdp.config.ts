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
  workers: 1,
  // Tier-specific report/output folders so a combined `npm run test:e2e` run keeps both tiers'
  // reports side by side instead of the cdp run overwriting the smoke run's. `open: 'never'` keeps
  // a run from auto-launching a browser in CI.
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
