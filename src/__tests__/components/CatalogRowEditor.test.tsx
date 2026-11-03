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
  glossRetry: GlossRetry = createGlossRetry(jest.fn()),
  gloss = 'start',
  analysisLanguage = 'en',
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
        analysisLanguage={analysisLanguage}
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
      const glossRetry = createGlossRetry(jest.fn());
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry));

      const input = screen.getByTestId('catalog-row-gloss-input');
      expect(input).toHaveValue('beginning');
      expect(input).toHaveAttribute('data-draft-field', 'pending');
    });

    it('sends the shown draft again on Enter', async () => {
      const glossRetry = createGlossRetry(jest.fn());
      await failAfterUnmount(glossRetry);
      const onGlossCommit = jest.fn();
      render(editor(onGlossCommit, glossRetry));

      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Enter}');

      expect(onGlossCommit.mock.calls).toStrictEqual([['beginning']]);
    });

    it('shows the draft only once', async () => {
      const glossRetry = createGlossRetry(jest.fn());
      await failAfterUnmount(glossRetry);
      const { unmount } = render(editor(jest.fn(), glossRetry));
      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Escape}');
      unmount();

      render(editor(jest.fn(), glossRetry));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('start');
    });

    it('drops the draft once the gloss has changed since it was typed', async () => {
      const glossRetry = createGlossRetry(jest.fn());
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry, 'origin'));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('origin');
    });

    it('keeps the draft out of another analysis language', async () => {
      const glossRetry = createGlossRetry(jest.fn());
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry, 'start', 'fr'));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('start');
    });

    it('reports holding the draft once the commit fails', async () => {
      const onHeldChange = jest.fn();
      await failAfterUnmount(createGlossRetry(onHeldChange));

      expect(onHeldChange).toHaveBeenLastCalledWith(true);
    });

    it('reports the draft held while the field shows it unsent', async () => {
      const onHeldChange = jest.fn();
      const glossRetry = createGlossRetry(onHeldChange);
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry));

      expect(glossRetry.isHolding()).toBe(true);
    });

    it('reports holding no draft once the field shows it again and sends it', async () => {
      const onHeldChange = jest.fn();
      const glossRetry = createGlossRetry(onHeldChange);
      await failAfterUnmount(glossRetry);
      render(editor(jest.fn(), glossRetry));

      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Enter}');

      expect(onHeldChange).toHaveBeenLastCalledWith(false);
    });

    it('reports holding no draft once the gloss has changed since it was typed', async () => {
      const onHeldChange = jest.fn();
      const glossRetry = createGlossRetry(onHeldChange);
      await failAfterUnmount(glossRetry);

      render(editor(jest.fn(), glossRetry, 'origin'));

      expect(onHeldChange).toHaveBeenLastCalledWith(false);
    });
  });

  it('reports holding a draft whose commit fails while the field is mounted', async () => {
    const glossRetry = createGlossRetry(jest.fn());
    let rejectCommit: (error: Error) => void = () => {};
    const onGlossCommit = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    render(editor(onGlossCommit, glossRetry));
    const input = screen.getByTestId('catalog-row-gloss-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'beginning{Enter}');
    let heldWhenSettled: boolean | undefined;
    const settled = glossRetry.afterCommits(() => {
      heldWhenSettled = glossRetry.isHolding();
    });

    await act(async () => {
      rejectCommit(new Error('refused'));
      await settled;
    });

    expect(heldWhenSettled).toBe(true);
  });

  describe('when the field unmounts holding an unsent draft', () => {
    /** Types "beginning" over "start" without committing it, then unmounts the editor. */
    async function unmountUnsent(onGlossCommit: () => void, glossRetry: GlossRetry) {
      const { rerender } = render(editor(onGlossCommit, glossRetry));
      const input = screen.getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'beginning');
      rerender(<AnalysisStoreProvider analysisLanguage="en">{undefined}</AnalysisStoreProvider>);
    }

    it('does not send the draft', async () => {
      const onGlossCommit = jest.fn();
      await unmountUnsent(onGlossCommit, createGlossRetry(jest.fn()));

      expect(onGlossCommit).not.toHaveBeenCalled();
    });

    it('shows the draft again when the field mounts', async () => {
      const glossRetry = createGlossRetry(jest.fn());
      await unmountUnsent(jest.fn(), glossRetry);

      render(editor(jest.fn(), glossRetry));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('beginning');
    });
  });

  describe('when the analysis language changes', () => {
    /** Types "beginning" over the English "start" without committing it, then switches to French. */
    async function switchToFrench(onGlossCommit: () => void, glossRetry: GlossRetry) {
      const { rerender } = render(editor(onGlossCommit, glossRetry));
      const input = screen.getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'beginning');
      rerender(editor(onGlossCommit, glossRetry, 'start', 'fr'));
      return rerender;
    }

    it("shows the new language's gloss over one typed in the old", async () => {
      await switchToFrench(jest.fn(), createGlossRetry(jest.fn()));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('start');
    });

    it('sends nothing for the draft typed in the old language', async () => {
      const onGlossCommit = jest.fn();
      await switchToFrench(onGlossCommit, createGlossRetry(jest.fn()));

      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), '{Enter}');

      expect(onGlossCommit).not.toHaveBeenCalled();
    });

    it("shows the old language's draft again on switching back", async () => {
      const onGlossCommit = jest.fn();
      const glossRetry = createGlossRetry(jest.fn());
      const rerender = await switchToFrench(onGlossCommit, glossRetry);

      rerender(editor(onGlossCommit, glossRetry));

      expect(screen.getByTestId('catalog-row-gloss-input')).toHaveValue('beginning');
    });
  });
});

describe('createGlossRetry', () => {
  it('runs a call after commits at once when none is in flight', () => {
    const then = jest.fn();

    createGlossRetry(jest.fn()).afterCommits(then);

    expect(then).toHaveBeenCalled();
  });

  /** A retry tracking one commit in flight, with the call that settles it. */
  function retryWithCommitInFlight() {
    const glossRetry = createGlossRetry(jest.fn());
    let resolveCommit: () => void = () => {};
    glossRetry.track(
      new Promise<void>((resolve) => {
        resolveCommit = resolve;
      }),
    );
    return { glossRetry, resolve: resolveCommit };
  }

  it('holds a call after commits while a commit is in flight', async () => {
    const { glossRetry } = retryWithCommitInFlight();
    const then = jest.fn();

    glossRetry.afterCommits(then);
    await Promise.resolve();

    expect(then).not.toHaveBeenCalled();
  });

  it('runs a call after commits once the commit in flight settles', async () => {
    const { glossRetry, resolve } = retryWithCommitInFlight();
    const then = jest.fn();
    const settled = glossRetry.afterCommits(then);

    resolve();
    await settled;

    expect(then).toHaveBeenCalled();
  });
});
