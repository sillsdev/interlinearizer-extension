import { expect, test } from '../../fixtures/cdp.fixture';
import {
  ensureInterlinearizerOpenOnWeb,
  getInterlinearizerFrame,
  openInterlinearizerProjectMenu,
  waitForAppAndInterlinearizerReady,
} from '../../fixtures/helpers';

/**
 * The project-related modals reachable from the Interlinearizer's ≡ (Project) menu, each with the
 * menu item that opens it and the title element that identifies it (from ModalShell's `titleId`).
 * The tour is read-only: each modal is opened, verified, and canceled — no project is created,
 * saved, or deleted, so the shared CDP instance is left untouched.
 */
const MODAL_TOURS = [
  {
    name: 'Select Interlinear Project',
    menuItem: /Select Interlinear Project/i,
    titleSelector: '#select-project-modal-title',
  },
  {
    name: 'New Interlinear Project',
    menuItem: /New Interlinear Project/i,
    titleSelector: '#create-project-modal-title',
  },
  {
    name: 'Save As',
    menuItem: /^Save As/i,
    titleSelector: '#save-as-modal-title',
  },
];

test.describe('Project modals cancel tour', () => {
  MODAL_TOURS.forEach((modal) => {
    test(`the ${modal.name} modal opens from the Project menu and cancels cleanly`, async ({
      mainPage,
    }) => {
      await waitForAppAndInterlinearizerReady(mainPage);
      await ensureInterlinearizerOpenOnWeb(mainPage);

      const frame = await openInterlinearizerProjectMenu(mainPage);
      await frame.getByRole('menuitem', { name: modal.menuItem }).first().click();

      const modalTitle = frame.locator(modal.titleSelector);
      await expect(modalTitle).toBeVisible({ timeout: 5_000 });

      await frame.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(modalTitle).not.toBeVisible({ timeout: 5_000 });

      // The underlying view must still be interactive after the modal unmounts — a stuck
      // overlay is the most common real modal regression.
      const projectMenuButton = getInterlinearizerFrame(mainPage)
        .locator("button[aria-label='Project']")
        .first();
      await expect(projectMenuButton).toBeVisible({ timeout: 5_000 });
      await expect(projectMenuButton).toBeEnabled();
    });
  });
});
