import { test, expect } from '../../fixtures/app.fixture';
import {
  openInterlinearizerFromScriptureEditor,
  waitForAppReady,
  waitForInterlinearizerReady,
} from '../../fixtures/helpers';

test.describe('Open Interlinearizer', () => {
  test('should open the interlinearizer and see its menus', async ({ mainPage }) => {
    await waitForAppReady(mainPage);
    await waitForInterlinearizerReady();

    await openInterlinearizerFromScriptureEditor(mainPage);

    // The Interlinearizer WebView renders its toolbar (and both menu buttons) inside its iframe.
    const interlinearizerFrame = mainPage.frameLocator('iframe[title="Interlinearizer"]');

    // Verify the ≡ (Project) menu button is visible and opens a menu.
    const projectMenuButton = interlinearizerFrame.locator("button[aria-label='Project']").first();
    await expect(projectMenuButton).toBeVisible({ timeout: 15_000 });
    await projectMenuButton.click();
    await expect(interlinearizerFrame.locator('[role="menu"]')).toBeVisible({ timeout: 5_000 });
    await mainPage.keyboard.press('Escape');
    await expect(interlinearizerFrame.locator('[role="menu"]')).not.toBeVisible({ timeout: 3_000 });

    // The ⚙ (View options) button only appears once the book data has loaded (isLoaded = true).
    const viewOptionsButton = interlinearizerFrame.getByTestId('view-options-button');
    await expect(viewOptionsButton).toBeVisible({ timeout: 30_000 });
    await viewOptionsButton.click();
    await expect(interlinearizerFrame.getByTestId('view-options-panel')).toBeVisible({
      timeout: 5_000,
    });
  });
});
