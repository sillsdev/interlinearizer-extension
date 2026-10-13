import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the performance harness. It launches (or reuses) Platform.Bible as
 * the CDP feature tier does, over empty extension storage, and never retries a spec: a retried
 * measurement would be a different measurement.
 */
export default defineConfig({
  testDir: './tests/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60 * 60_000,
  expect: { timeout: 30_000 },
  use: { actionTimeout: 30_000 },
  globalSetup: './global-setup-perf.ts',
  globalTeardown: './global-teardown-perf.ts',
  outputDir: './test-results/perf',
  projects: [
    { name: 'capture', testMatch: /capture-usj\.spec\.ts/ },
    { name: 'app', testMatch: /app-perf\.spec\.ts/ },
  ],
});
