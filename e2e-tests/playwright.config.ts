// Adapted from paranext-core/e2e-tests/playwright.config.ts
import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for interlinearizer extension E2E tests.
 *
 * Launches Platform.Bible with the interlinearizer extension loaded via `--extensions`.
 *
 * Prerequisites:
 *
 * - `npm run build` must have been run (dist/src/main.js must exist)
 * - Paranext-core must be cloned at `../../paranext-core` with deps installed
 * - `smoke`: tests share a single Electron instance per worker — fast, for CI.
 * - `isolated`: each test gets a fresh Electron restart — for state-mutating tests.
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/_example/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  outputDir: './test-results',
  projects: [
    {
      name: 'smoke',
      testDir: './tests/smoke',
    },
  ],
});
