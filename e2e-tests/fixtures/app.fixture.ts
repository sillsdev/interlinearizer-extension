// Adapted from paranext-core/e2e-tests/fixtures/app.fixture.ts
import {
  test as base,
  ElectronApplication,
  Page,
  TestInfo,
  ConsoleMessage,
} from '@playwright/test';
import {
  launchElectronWithExtension,
  teardownElectronApp,
  ElectronAppContext,
  PROCESS_READY_TIMEOUT,
} from './helpers';

export { expect } from '@playwright/test';

/** Worker-scoped fixtures — one instance shared across all tests in a worker. */
export interface WorkerAppFixtures {
  electronApp: ElectronApplication;
}

/** Test-scoped fixtures — re-created for every test. */
export interface TestAppFixtures {
  mainPage: Page;
}

export const test = base.extend<TestAppFixtures, WorkerAppFixtures>({
  // Worker-scoped: the Electron process is launched once per worker and shared across all tests,
  // avoiding the process startup/teardown cost per test.
  electronApp: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const ctx: ElectronAppContext = await launchElectronWithExtension();

      await use(ctx.electronApp);

      console.log('[teardown] Worker-scoped app teardown starting...');
      await teardownElectronApp(ctx);
      console.log('[teardown] Worker-scoped app teardown complete — worker will exit now');
    },
    { scope: 'worker' },
  ],

  mainPage: async ({ electronApp }, use, testInfo: TestInfo) => {
    const page = await electronApp.firstWindow({ timeout: PROCESS_READY_TIMEOUT });

    console.log(`Window URL: ${page.url()}`);
    const onPageError = (err: Error) => console.error(`Page error: ${err.message}`);
    const onConsoleMsg = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') console.error(`Console error: ${msg.text()}`);
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsoleMsg);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#root', { state: 'attached', timeout: PROCESS_READY_TIMEOUT });

    await use(page);

    page.off('pageerror', onPageError);
    page.off('console', onConsoleMsg);

    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshotPath = testInfo.outputPath('failure.png');
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await testInfo.attach('failure-screenshot', {
          path: screenshotPath,
          contentType: 'image/png',
        });
        console.log(`Failure screenshot saved to ${screenshotPath}`);
      } catch {
        console.warn('Could not capture failure screenshot (window may already be closed)');
      }
    }
  },
});
