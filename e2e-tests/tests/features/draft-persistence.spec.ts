import { expect, test } from '../../fixtures/cdp.fixture';
import {
  closeInterlinearizerTab,
  ensureE2eProjectActive,
  ensureInterlinearizerOpenOnWeb,
  getInterlinearizerFrame,
  navigateToScriptureRef,
  waitForAppAndInterlinearizerReady,
  wipeDraft,
} from '../../fixtures/helpers';

test.describe('Draft persistence', () => {
  test('a glossed draft survives closing and reopening the interlinearizer', async ({
    mainPage,
  }) => {
    // Two full open cycles (plus first-use project creation and book loading on a cold instance)
    // legitimately exceed the default 120 s budget.
    test.slow();
    // Lenient gate: the shared CDP instance was already settled by global setup, so a single stray
    // panel must not fail this (and every downstream) test — see waitForDockTabTitlesResolved.
    await waitForAppAndInterlinearizerReady(mainPage, { strict: false });
    await ensureInterlinearizerOpenOnWeb(mainPage);
    await ensureE2eProjectActive(mainPage);
    await navigateToScriptureRef(mainPage, 'GEN 1:1');
    await wipeDraft(mainPage);

    const frame = getInterlinearizerFrame(mainPage);
    const glossInput = frame.getByLabel('Gloss for beginning', { exact: true }).first();
    await expect(glossInput).toBeVisible({ timeout: 30_000 });

    // Unique per run so a leftover value from a previous run can never false-pass.
    const gloss = `e2e-persist-${Date.now()}`;
    await glossInput.click();
    await glossInput.fill(gloss);
    await glossInput.press('Tab');
    await expect(glossInput).toHaveValue(gloss);

    // The draft auto-saves on a 300 ms debounce after the last keystroke, and there is no UI
    // signal that the storage write has landed (the tab's dirty marker tracks draft-vs-saved-
    // project, not draft-vs-storage). This fixed wait deliberately covers the debounce so the
    // test exercises the debounced-save path; the unmount-flush (close immediately after
    // typing) path is intentionally out of scope here.
    await mainPage.waitForTimeout(1_000);

    await closeInterlinearizerTab(mainPage);

    await ensureInterlinearizerOpenOnWeb(mainPage);
    await navigateToScriptureRef(mainPage, 'GEN 1:1');

    const reopenedFrame = getInterlinearizerFrame(mainPage);
    const reopenedGlossInput = reopenedFrame
      .getByLabel('Gloss for beginning', { exact: true })
      .first();
    await expect(reopenedGlossInput).toBeVisible({ timeout: 30_000 });
    await expect(reopenedGlossInput).toHaveValue(gloss);

    // Discard this test's leftover gloss (reload the e2e project into the draft) so the next run
    // starts clean instead of triggering the dirty-draft rescue. Rescue must stay off here: the
    // close/reopen dropped the active-project WebView state, so the dirty draft would otherwise
    // look like developer work.
    await ensureE2eProjectActive(mainPage, { rescueDirtyDraft: false });
  });
});
