/**
 * === REFERENCE EXAMPLE ===
 *
 * Template for per-feature E2E tests using cdp.fixture. Copy this file when writing tests for
 * specific interlinearizer UI features.
 *
 * Key rules:
 *
 * - ALWAYS import from '../../fixtures/cdp.fixture' (NOT app.fixture)
 * - ALWAYS navigate via visible UI (menu clicks, button presses)
 * - NEVER use direct JSON-RPC/WebSocket calls to drive the test
 * - Cdp.fixture only provides { mainPage } — no electronApp
 *
 * This file is excluded from test runs — it's documentation only.
 */
import { test, expect } from '../../fixtures/cdp.fixture';
import { waitForAppReady, waitForInterlinearizerReady } from '../../fixtures/helpers';

/**
 * Filter out expected/benign console errors from a list of captured error messages.
 *
 * @param errors Array of console error message strings to filter.
 * @returns The subset of `errors` that are not considered benign.
 */
function filterConsoleErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('DevTools') &&
      !e.includes('favicon') &&
      !e.includes('source map') &&
      !e.includes('net::ERR_'),
  );
}

test.describe('Example: Open Interlinearizer via menu', () => {
  test('should open the interlinearizer WebView via menu', async ({ mainPage }) => {
    await waitForAppReady(mainPage);
    await waitForInterlinearizerReady();

    // Step 1: Click the top-level menu that contains the interlinearizer entry
    const menuTrigger = mainPage.getByRole('menuitem', { name: /Tools/i });
    await menuTrigger.click();

    // Step 2: Click the interlinearizer entry in the dropdown
    const featureItem = mainPage.getByRole('menuitem', { name: /Interlinearizer/i });
    await featureItem.click();

    // Step 3: Verify the WebView tab opened in the dock
    const tab = mainPage.locator('.dock-tab', { hasText: /Interlinearizer/i });
    await expect(tab).toBeVisible({ timeout: 15_000 });
  });

  test('should render without critical console errors', async ({ mainPage }) => {
    await waitForAppReady(mainPage);
    await waitForInterlinearizerReady();

    const consoleErrors: string[] = [];
    mainPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Navigate to the feature
    const menuTrigger = mainPage.getByRole('menuitem', { name: /Tools/i });
    await menuTrigger.click();
    const featureItem = mainPage.getByRole('menuitem', { name: /Interlinearizer/i });
    await featureItem.click();

    const tab = mainPage.locator('.dock-tab', { hasText: /Interlinearizer/i });
    await expect(tab).toBeVisible({ timeout: 15_000 });

    // For WebView content inside iframes, switch frame context:
    // const webViewFrame = mainPage.frameLocator('iframe[title="Interlinearizer WebView Title"]');
    // await expect(webViewFrame.locator('[data-testid="my-component"]')).toBeVisible();

    const criticalErrors = filterConsoleErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });
});
