/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import CatalogRowEditor, { ROW_EDITOR_STRING_KEYS } from '../../components/CatalogRowEditor';
import type { Settles } from '../../utils/settles';

const STRINGS = Object.fromEntries(ROW_EDITOR_STRING_KEYS.map((key) => [key, key]));

/** The editor over an analysis glossed "start", reporting each gloss commit to `onGlossCommit`. */
function editor(onGlossCommit: (value: string) => Settles<unknown>) {
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

  it('sends a gloss again after its commit fails', async () => {
    const onGlossCommit = jest.fn(async () => {
      throw new Error('refused');
    });
    render(editor(onGlossCommit));
    const input = screen.getByTestId('catalog-row-gloss-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'beginning{Enter}');
    await waitFor(() => expect(input).toHaveAttribute('data-draft-field', 'pending'));
    await userEvent.type(input, '{Enter}');

    await waitFor(() =>
      expect(onGlossCommit.mock.calls).toStrictEqual([['beginning'], ['beginning']]),
    );
  });

  it('does not send a gloss again while its commit is pending', async () => {
    const onGlossCommit = jest.fn(() => new Promise<void>(() => {}));
    render(editor(onGlossCommit));
    const input = screen.getByTestId('catalog-row-gloss-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'beginning{Enter}{Enter}');

    expect(onGlossCommit.mock.calls).toStrictEqual([['beginning']]);
  });

  it('keeps a later gloss sent when an earlier commit fails', async () => {
    const rejects: ((error: Error) => void)[] = [];
    const onGlossCommit = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejects.push(reject);
        }),
    );
    render(editor(onGlossCommit));
    const input = screen.getByTestId('catalog-row-gloss-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'beginning{Enter}');
    await userEvent.type(input, 's{Enter}');
    await act(async () => rejects[0](new Error('refused')));
    await userEvent.type(input, '{Enter}');

    expect(onGlossCommit.mock.calls).toStrictEqual([['beginning'], ['beginnings']]);
  });
});
