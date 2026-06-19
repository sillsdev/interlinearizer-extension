import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady, waitForInterlinearizerReady } from '../../fixtures/helpers';

test.describe('Launch app and register Interlinearizer', () => {
  test('should launch Platform.Bible and create at least one window', async ({ electronApp }) => {
    expect(electronApp.windows().length).toBeGreaterThanOrEqual(1);
  });

  test('should render the React root', async ({ mainPage }) => {
    await mainPage.waitForSelector('#root', { state: 'attached', timeout: 30_000 });
    const root = mainPage.locator('#root');
    await expect(root).toBeAttached();
  });

  test('should load the dock layout', async ({ mainPage }) => {
    await waitForAppReady(mainPage);
    const dock = mainPage.locator('div[class*="dock-layout"]');
    await expect(dock).toBeAttached({ timeout: 60_000 });
  });

  test('should register Interlinearizer PAPI commands', async ({ mainPage }) => {
    await waitForAppReady(mainPage);
    await waitForInterlinearizerReady();
  });
});
