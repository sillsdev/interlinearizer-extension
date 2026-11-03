/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import CatalogRowEditor, {
  createGlossRetry,
  type GlossRetry,
  ROW_EDITOR_STRING_KEYS,
} from '../../components/CatalogRowEditor';
import type { Settles } from '../../utils/settles';

const STRINGS = Object.fromEntries(ROW_EDITOR_STRING_KEYS.map((key) => [key, key]));

/** The editor over an analysis glossed `gloss`, reporting each gloss commit to `onGlossCommit`. */
function editor(
  onGlossCommit: (value: string) => Settles<unknown>,
  glossRetry: GlossRetry = createGlossRetry(),
  gloss = 'start',
) {
  return (
    <AnalysisStoreProvider analysisLanguage="en">
      <CatalogRowEditor
        analysisId="ta-1"
        surfaceText="ἀρχῇ"
        gloss={gloss}
        glossRetry={glossRetry}
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

  describe('when a commit fails after the field unmounts', () => {
    /** Commits "beginning" over "start", unmounts the editor, then fails the commit. */
    async function failAfterUnmount(glossRetry: GlossRetry) {
      const rejects: ((error: Error) => void)[] = [];
      const onGlossCommit = jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejects.push(reject);
          }),
      );
      const { rerender, unmount } = render(editor(onGlossCommit, glossRetry));
      const input = screen.getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'beginning{Enter}');
      rerender(<AnalysisStoreProvider analysisLanguage="en">{undefined}</AnalysisStoreProvider>);
      await act(async () => rejects[0](new Error('refused')));
      unmount();
    }

    it('shows the draft again when the field mounts', async () => {
      const glossRetry = createGlossRetry();
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry));

      const input = screen.getByTestId('catalog-row-gloss-input');
      expect(input).toHaveValue('beginning');
      expect(input).toHaveAttribute('data-draft-field', 'pending');
    });

    it('sends the shown draft again on Enter', async () => {
      const glossRetry = createGlossRetry();
      await failAfterUnmount(glossRetry);
      const onGlossCommit = jest.fn();
      render(editor(onGlossCommit, glossRetry));

      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Enter}');

      expect(onGlossCommit.mock.calls).toStrictEqual([['beginning']]);
    });

    it('shows the draft only once', async () => {
      const glossRetry = createGlossRetry();
      await failAfterUnmount(glossRetry);
      const { unmount } = render(editor(jest.fn(), glossRetry));
      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Escape}');
      unmount();

      render(editor(jest.fn(), glossRetry));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('start');
    });

    it('drops the draft once the gloss has changed since it was typed', async () => {
      const glossRetry = createGlossRetry();
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry, 'origin'));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('origin');
    });
  });
});
