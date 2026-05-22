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
    const rendererUrl = 'http://localhost:1212/index.html?logLevel=debug';
    const readyDeadline = Date.now() + PROCESS_READY_TIMEOUT;

    /**
     * Log an uncaught page error to the console.
     *
     * @param err The error thrown in the page context.
     */
    const onPageError = (err: Error) => console.error(`Page error: ${err.message}`);

    /**
     * Log console error messages from the page to the process console.
     *
     * @param msg The console message emitted by the page.
     */
    const onConsoleMsg = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') console.error(`Console error: ${msg.text()}`);
    };

    /**
     * Attach error and console listeners to a page for test observability.
     *
     * @param page The Playwright page to listen on.
     */
    const attachListeners = (page: Page) => {
      page.on('pageerror', onPageError);
      page.on('console', onConsoleMsg);
    };

    /**
     * Remove error and console listeners previously attached by {@link attachListeners}.
     *
     * @param page The Playwright page to stop listening on.
     */
    const detachListeners = (page: Page) => {
      page.off('pageerror', onPageError);
      page.off('console', onConsoleMsg);
    };

    let page: Page | undefined;
    while (Date.now() < readyDeadline) {
      const pages = electronApp.windows();
      page =
        pages.find((candidate) => {
          const candidateUrl = candidate.url();
          return (
            candidateUrl.startsWith('http://localhost:1212/') &&
            !candidateUrl.includes('devtools://')
          );
        }) ?? pages.find((candidate) => !candidate.url().includes('devtools://'));

      if (page) {
        attachListeners(page);

        try {
          const currentUrl = page.url();
          console.log(`Window URL: ${currentUrl}`);

          // CI can intermittently land on chrome-error://chromewebdata/ when Electron opens before the
          // renderer is fully ready. Playwright's page.goto() cannot navigate away from chrome-error://
          // pages in some Electron configurations — it throws immediately. Use Electron's main-process
          // BrowserWindow.loadURL() instead, which can force-reload the window from any URL state.
          if (
            currentUrl.startsWith('chrome-error://') ||
            currentUrl === 'about:blank' ||
            !currentUrl.startsWith('http://localhost:1212/')
          ) {
            await electronApp.evaluate(({ BrowserWindow }, url) => {
              const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
              if (win) win.loadURL(url).catch(() => {});
            }, rendererUrl);
            // Allow the navigation to start before we poll loadState.
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 1_000);
            });
          }

          const remaining = Math.max(0, readyDeadline - Date.now());
          if (remaining <= 0) break;

          await page.waitForLoadState('domcontentloaded');
          await page.waitForSelector('#root', {
            state: 'attached',
            timeout: Math.min(5_000, remaining),
          });

          console.log(`Window URL: ${page.url()}`);
          await use(page);
          detachListeners(page);

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
          return;
        } catch {
          detachListeners(page);
          page = undefined;
        }
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
    }

    throw new Error(
      `Main renderer did not mount #root within ${PROCESS_READY_TIMEOUT}ms (last URL: ${page?.url() ?? 'no window'})`,
    );
  },
});
