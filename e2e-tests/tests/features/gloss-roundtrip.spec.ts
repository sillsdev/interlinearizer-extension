import { expect, test } from '../../fixtures/cdp.fixture';
import {
  ensureE2eProjectActive,
  ensureInterlinearizerOpenOnWeb,
  getInterlinearizerFrame,
  navigateToScriptureRef,
  waitForAppAndInterlinearizerReady,
  wipeDraft,
} from '../../fixtures/helpers';

test.describe('Gloss round-trip', () => {
  test('typing a gloss on a token renders it in the gloss field', async ({ mainPage }) => {
    // This test front-loads the full open-project-and-navigate sequence and has been observed at
    // ~108s of the tier's 120s budget on CI, leaving no room for a slower runner. test.slow()
    // triples the timeout rather than raising it tier-wide, so the faster tests keep a tight bound.
    test.slow();
    // Shared-CDP readiness profile: lenient gate + short fail-fast budget — see the `cdp` option.
    await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });
    await ensureInterlinearizerOpenOnWeb(mainPage);
    await ensureE2eProjectActive(mainPage);
    await navigateToScriptureRef(mainPage, 'GEN 1:1');
    await wipeDraft(mainPage);

    const frame = getInterlinearizerFrame(mainPage);

    // WEB Genesis 1:1: "In the beginning, God created the heavens and the earth."
    const glossInput = frame.getByLabel('Gloss for beginning', { exact: true }).first();
    await expect(glossInput).toBeVisible({ timeout: 30_000 });
    // The wipe just cleared all analysis, so the field must start empty.
    await expect(glossInput).toHaveValue('');

    // Unique per run so a leftover value from a previous run can never false-pass.
    const gloss = `e2e-gloss-${Date.now()}`;
    await glossInput.click();
    await glossInput.fill(gloss);
    await glossInput.press('Tab');

    await expect(glossInput).toHaveValue(gloss);

    // Discard this test's leftover gloss (reload the e2e project into the draft) so the next run
    // starts clean instead of triggering the dirty-draft rescue.
    await ensureE2eProjectActive(mainPage, { rescueDirtyDraft: false });
  });
});
