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
 * menu item that opens it and the test id on the title element that identifies it. The tour is
 * read-only: each modal is opened, verified, and canceled — no project is created, saved, or
 * deleted, so the shared CDP instance is left untouched.
 */
const MODAL_TOURS = [
  {
    name: 'Select Interlinear Project',
    menuItem: /Select Interlinear Project/i,
    titleTestId: 'select-project-modal-title',
  },
  {
    name: 'New Interlinear Project',
    menuItem: /New Interlinear Project/i,
    titleTestId: 'create-project-modal-title',
  },
  {
    name: 'Save As',
    menuItem: /^Save As/i,
    titleTestId: 'save-as-modal-title',
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

      await modalDialog(frame).getByRole('button', { name: 'Cancel' }).click();
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
