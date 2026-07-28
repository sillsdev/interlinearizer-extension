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
  // Tier-specific report/output folders so the second tier's report doesn't overwrite the first's.
  // The `open: 'never'` keeps a run from auto-launching a browser in CI.
  reporter: [['html', { outputFolder: 'playwright-report/smoke', open: 'never' }], ['list']],
  // Headroom for a cold runner's one-time sample-project install, which `open-interlinearizer` waits
  // out via waitForAtLeastOneProjectMetadata. A CI Windows runner has been observed still installing
  // past 60s, and the test itself then needs ~40s, so 120_000 left no room and turned a slow-but-fine
  // first launch into a red attempt.
  //
  // Must clear the worst reachable chain in openInterlinearizerFromScriptureEditor, or a pathological
  // cold start reports an opaque "Test timeout" instead of the specific error whichever wait actually
  // lost: dock mount 45s + project metadata 150s + Home probe 5s + Home close 5s + Home reopen 30s +
  // loaded-editor 30s ≈ 265s. The metadata wait returns as soon as metadata appears and throws only
  // once its timeout is exhausted, so exhaustion is the only outcome that ends the test early — a
  // late success at ~149s still leaves every later wait in play. Revisit if any of those budgets
  // change.
  timeout: 300_000,
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
  outputDir: './test-results/smoke',
  projects: [
    {
      name: 'smoke',
      testDir: './tests/smoke',
    },
  ],
});
