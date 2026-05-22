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

/**
 * Playwright test fixture for smoke tests. Launches one Electron instance per worker (shared across
 * all tests in that worker) and provides `electronApp` and `mainPage`. Attaches a failure
 * screenshot to the report when a test does not meet its expected status.
 */
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
    const rendererUrl = 'http://localhost:1212/index.html?logLevel=debug';

    console.log(`Window URL: ${page.url()}`);
    const onPageError = (err: Error) => console.error(`Page error: ${err.message}`);
    const onConsoleMsg = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') console.error(`Console error: ${msg.text()}`);
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsoleMsg);

    const readyDeadline = Date.now() + PROCESS_READY_TIMEOUT;
    let rootAttached = false;

    while (Date.now() < readyDeadline) {
      const currentUrl = page.url();

      // CI can intermittently land on chrome-error://chromewebdata/ if Electron opens before the
      // renderer navigation has fully settled. Drive the page back to the actual renderer URL and
      // retry until React mounts or timeout.
      if (
        currentUrl.startsWith('chrome-error://') ||
        currentUrl === 'about:blank' ||
        !currentUrl.startsWith('http://localhost:1212/')
      ) {
        try {
          await page.goto(rendererUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });
        } catch {
          // Retry loop handles transient dev-server unavailability.
        }
      }

      const remaining = Math.max(0, readyDeadline - Date.now());
      if (remaining <= 0) break;

      try {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForSelector('#root', {
          state: 'attached',
          timeout: Math.min(5_000, remaining),
        });
        rootAttached = true;
        break;
      } catch {
        // Keep retrying until deadline.
      }
    }

    if (!rootAttached) {
      throw new Error(
        `Main renderer did not mount #root within ${PROCESS_READY_TIMEOUT}ms (current URL: ${page.url()})`,
      );
    }

    console.log(`Window URL: ${page.url()}`);

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
