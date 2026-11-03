/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import CatalogRowEditor, { ROW_EDITOR_STRING_KEYS } from '../../components/CatalogRowEditor';

const STRINGS = Object.fromEntries(ROW_EDITOR_STRING_KEYS.map((key) => [key, key]));

/** The editor over an analysis glossed "start", reporting each gloss commit to `onGlossCommit`. */
function editor(onGlossCommit: (value: string) => void) {
  return (
    <AnalysisStoreProvider analysisLanguage="en">
      <CatalogRowEditor
        analysisId="ta-1"
        surfaceText="ἀρχῇ"
        gloss="start"
        usageCount={1}
        morphemes={[]}
        analysisLanguage="en"
        showMorphology={false}
        onGlossCommit={onGlossCommit}
        onMorphemesCommit={() => {}}
        onMorphemesConfirm={() => {}}
        onMorphemeGlossCommit={() => {}}
        breakdownDraft={undefined}
        onBreakdownDraftChange={() => {}}
        localizedStrings={STRINGS}
      />
    </AnalysisStoreProvider>
  );
}

describe('CatalogRowEditor', () => {
  it('sends a committed gloss once when the row unmounts before the gloss comes back', async () => {
    // The committed gloss stays "start", as it does until the session's reply arrives.
    const onGlossCommit = jest.fn();
    const { rerender } = render(editor(onGlossCommit));
    const input = screen.getByTestId('catalog-row-gloss-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'beginning');
    await userEvent.tab();

    rerender(<AnalysisStoreProvider analysisLanguage="en">{undefined}</AnalysisStoreProvider>);

    expect(onGlossCommit.mock.calls).toStrictEqual([['beginning']]);
  });
});
