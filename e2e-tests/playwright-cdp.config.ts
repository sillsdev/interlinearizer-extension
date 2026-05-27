// Adapted from paranext-core/e2e-tests/playwright-cdp.config.ts
import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for running E2E tests against an already-running Platform.Bible instance
 * with CDP enabled (port 9223).
 *
 * Prerequisites: Platform.Bible running with --remote-debugging-port=9223 and the interlinearizer
 * extension loaded.
 *
 * Use: npx playwright test --config=e2e-tests/playwright-cdp.config.ts
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/smoke/**', '**/_example/**'],
  fullyParallel: false,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: './test-results',
  // NO globalSetup/globalTeardown — app is already running
});
