import { expect, test } from '../../fixtures/cdp.fixture';
import {
  ensureInterlinearizerOpenOnWeb,
  getInterlinearizerFrame,
  modalDialog,
  openInterlinearizerProjectMenu,
  waitForAppAndInterlinearizerReady,
} from '../../fixtures/helpers';

/**
 * The project-related modals reachable from the Interlinearizer's ≡ (Project) menu, each with the
 * menu item that opens it, the test id on the title element that identifies it, and the footer
 * button that dismisses it. The tour is read-only: each modal is opened, verified, and dismissed.
 * No project is created, saved, or deleted, so the shared CDP instance is left untouched.
 */
const MODAL_TOURS = [
  {
    name: 'Select interlinear',
    menuItem: /Select interlinear/i,
    titleTestId: 'select-project-modal-title',
    dismissButton: 'Cancel',
  },
  {
    name: 'New interlinear',
    menuItem: /New interlinear/i,
    titleTestId: 'create-project-modal-title',
    dismissButton: 'Cancel',
  },
  {
    name: 'Save As',
    menuItem: /^Save As/i,
    titleTestId: 'save-as-modal-title',
    dismissButton: 'Close',
  },
];

test.describe('Project modals cancel tour', () => {
  MODAL_TOURS.forEach((modal) => {
    test(`the ${modal.name} modal opens from the Project menu and cancels cleanly`, async ({
      mainPage,
    }) => {
      // Shared-CDP readiness profile: lenient gate + short fail-fast budget — see the `cdp` option.
      await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });
      await ensureInterlinearizerOpenOnWeb(mainPage);

      const frame = await openInterlinearizerProjectMenu(mainPage);
      await frame.getByRole('menuitem', { name: modal.menuItem }).first().click();

      const modalTitle = frame.getByTestId(modal.titleTestId);
      await expect(modalTitle).toBeVisible({ timeout: 5_000 });

      await modalDialog(frame)
        .getByRole('button', { name: modal.dismissButton, exact: true })
        .click();
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
