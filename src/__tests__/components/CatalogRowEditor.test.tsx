/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MorphemeAnalysis } from 'interlinearizer';
import type { SenseCandidate } from 'interlinearizer/lexicon';
import type { ComponentProps } from 'react';
import CatalogRowEditor, {
  createGlossRetry,
  type GlossRetry,
  ROW_EDITOR_STRING_KEYS,
} from '../../components/CatalogRowEditor';
import type { CatalogRow } from '../../utils/analysis-query';
import type { Settles } from '../../utils/settles';
import { FIXTURE_STAMPS } from '../test-helpers';
import {
  EmptyAnalysisProvider,
  TEST_LEXICON_AUTHORITY,
  testSenseRef,
  withLexicon,
  withTooltipProvider,
} from './test-helpers';

const STRINGS = Object.fromEntries(ROW_EDITOR_STRING_KEYS.map((key) => [key, key]));

/** The editor over an analysis glossed `gloss`, reporting each gloss commit to `onGlossCommit`. */
function editor(
  onGlossCommit: (value: string) => Settles<unknown>,
  glossRetry: GlossRetry = createGlossRetry(jest.fn()),
  gloss = 'start',
  analysisLanguage = 'en',
) {
  return (
    <EmptyAnalysisProvider analysisLanguage="en">
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
        onLinkMorphemeSense={() => {}}
        onUnlinkMorphemeSense={() => {}}
        onAdoptMorphemeSenseGloss={() => {}}
        breakdownDraft={undefined}
        onBreakdownDraftChange={() => {}}
        localizedStrings={STRINGS}
      />
    </EmptyAnalysisProvider>
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

    rerender(<EmptyAnalysisProvider analysisLanguage="en">{undefined}</EmptyAnalysisProvider>);

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
      rerender(<EmptyAnalysisProvider analysisLanguage="en">{undefined}</EmptyAnalysisProvider>);
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
      rerender(<EmptyAnalysisProvider analysisLanguage="en">{undefined}</EmptyAnalysisProvider>);
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

/** A morpheme of the form `form`, carrying only what a case sets beyond that. */
function morpheme(id: string, form: string, overrides: Partial<MorphemeAnalysis> = {}) {
  return { id, form, writingSystem: 'el', ...FIXTURE_STAMPS, ...overrides };
}

/** A search hit for the sense `senseId`. */
function candidate(senseId: string): SenseCandidate {
  return {
    gloss: { en: senseId },
    entryRef: { authority: TEST_LEXICON_AUTHORITY, entryId: `e-${senseId}` },
    senseRef: testSenseRef(senseId),
  };
}

describe('CatalogRowEditor lexicon links', () => {
  const SENSES = { 's-word': { gloss: { en: 'word' } }, 's-stem': { gloss: { en: 'speak' } } };
  const search = async () => [candidate('s-other')];
  const LABEL = '%interlinearizer_analysisCatalog_morphemeSenseLinks%';

  /** The editor over `props`, beneath a lexicon holding {@link SENSES}, which can search or not. */
  async function renderEditor(
    props: Partial<ComponentProps<typeof CatalogRowEditor>> = {},
    { readOnly = false, canSearch = true }: { readOnly?: boolean; canSearch?: boolean } = {},
  ) {
    const handlers = {
      onLinkMorphemeSense: jest.fn(),
      onUnlinkMorphemeSense: jest.fn(),
      onAdoptMorphemeSenseGloss: jest.fn(),
    };
    const { ui } = withLexicon(
      withTooltipProvider(
        <EmptyAnalysisProvider analysisLanguage="en" readOnly={readOnly}>
          <CatalogRowEditor
            analysisId="ta-1"
            analysisLanguage="en"
            breakdownDraft={undefined}
            gloss=""
            glossRetry={createGlossRetry(jest.fn())}
            localizedStrings={STRINGS}
            morphemes={[morpheme('m-1', 'λογ'), morpheme('m-2', 'ος')]}
            onBreakdownDraftChange={() => {}}
            onGlossCommit={() => {}}
            onMorphemeGlossCommit={() => {}}
            onMorphemesCommit={() => {}}
            onMorphemesConfirm={() => {}}
            showMorphology
            surfaceText="λόγος"
            usageCount={1}
            {...handlers}
            {...props}
          />
        </EmptyAnalysisProvider>,
      ),
      SENSES,
      canSearch ? search : undefined,
    );
    render(ui);
    // Lets the sense look-ups that rendering started land, so none updates a row after the test.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    return handlers;
  }

  it("offers the linked sense's gloss as the gloss input's placeholder, leaving it empty", async () => {
    await renderEditor({ glossSenseRef: testSenseRef('s-word') });

    const input = screen.getByTestId('catalog-row-gloss-input');
    await waitFor(() => expect(input).toHaveAttribute('placeholder', 'word'));
    expect(input).toHaveValue('');
  });

  it('gives a gloss input no placeholder where the analysis links to no sense', async () => {
    await renderEditor();

    expect(screen.getByTestId('catalog-row-gloss-input')).not.toHaveAttribute('placeholder');
  });

  it("offers each morpheme's linked sense's gloss as its gloss input's placeholder", async () => {
    await renderEditor({
      morphemes: [
        morpheme('m-1', 'λογ', { senseRef: testSenseRef('s-stem') }),
        morpheme('m-2', 'ος'),
      ],
    });

    const [first, second] = screen.getAllByTestId('catalog-row-morpheme-gloss-input');
    await waitFor(() => expect(first).toHaveAttribute('placeholder', 'speak'));
    expect(first).toHaveValue('');
    expect(second).not.toHaveAttribute('placeholder');
  });

  it('places each morpheme gloss input in the box row for glosses and its control in the next', async () => {
    await renderEditor();

    const [input] = screen.getAllByTestId('catalog-row-morpheme-gloss-input');
    const [control] = screen.getAllByTestId('catalog-sense-control');
    expect(input).toHaveStyle({ gridRow: '2', gridColumn: '2' });
    expect(control).toHaveStyle({ gridRow: '3', gridColumn: '2' });
  });

  it('labels the link row of an editable breakdown the lexicon can search for', async () => {
    await renderEditor();

    expect(screen.getByText(LABEL)).toBeInTheDocument();
  });

  it('leaves the link row unlabeled when nothing can be linked or shown there', async () => {
    await renderEditor({}, { canSearch: false });

    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  it('leaves the link row unlabeled when no morpheme has a form to search for', async () => {
    await renderEditor({ morphemes: [morpheme('m-1', '')] });

    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  it('labels the link row of a breakdown with a link even where nothing can be searched', async () => {
    await renderEditor(
      { morphemes: [morpheme('m-1', 'λογ', { senseRef: testSenseRef('s-stem') })] },
      { canSearch: false },
    );

    expect(screen.getByText(LABEL)).toBeInTheDocument();
  });

  it('links a morpheme to the sense picked from a search', async () => {
    const { onLinkMorphemeSense } = await renderEditor();

    await userEvent.click(screen.getAllByTestId('catalog-sense-control')[1]);
    await userEvent.click(screen.getByText('%interlinearizer_analysisCatalog_senseLinkAction%'));
    await userEvent.click(await screen.findByTestId('catalog-sense-candidate'));

    expect(onLinkMorphemeSense).toHaveBeenCalledWith('m-2', candidate('s-other'));
  });

  it("adopts and drops a morpheme's link by its id", async () => {
    const { onAdoptMorphemeSenseGloss, onUnlinkMorphemeSense } = await renderEditor({
      morphemes: [morpheme('m-1', 'λογ', { senseRef: testSenseRef('s-stem') })],
    });

    await userEvent.click(await screen.findByTestId('catalog-sense-control'));
    await userEvent.click(screen.getByText('%interlinearizer_analysisCatalog_senseAdoptGloss%'));
    await userEvent.click(screen.getByTestId('catalog-sense-control'));
    await userEvent.click(screen.getByText('%interlinearizer_analysisCatalog_senseUnlink%'));
    await userEvent.click(screen.getByText('%interlinearizer_analysisCatalog_senseKeepGloss%'));

    expect(onAdoptMorphemeSenseGloss).toHaveBeenCalledWith('m-1', 'speak');
    expect(onUnlinkMorphemeSense).toHaveBeenCalledWith('m-1', 'speak');
  });

  describe('read-only', () => {
    it("shows the sense's gloss for the analysis and its morphemes, each link as a mark", async () => {
      await renderEditor(
        {
          glossSenseRef: testSenseRef('s-word'),
          morphemes: [morpheme('m-1', 'λογ', { senseRef: testSenseRef('s-stem') })],
        },
        { readOnly: true },
      );

      await waitFor(() =>
        expect(screen.getByTestId('readonly-catalog-gloss')).toHaveTextContent('word'),
      );
      expect(screen.getByTestId('readonly-catalog-morpheme-gloss')).toHaveTextContent('speak');
      expect(screen.getByTestId('catalog-sense-link')).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-sense-control')).not.toBeInTheDocument();
      expect(screen.getByText(LABEL)).toBeInTheDocument();
    });

    it('leaves the link row unlabeled where no morpheme links to a sense', async () => {
      await renderEditor({}, { readOnly: true });

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    });
  });
});

describe('createGlossRetry', () => {
  it('runs a call after commits at once when none is in flight', async () => {
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

  /** A listing of one analysis "ta-1", glossed `glosses`, with one morpheme "m-1" glossed `stem`. */
  function rows(glosses: Record<string, string>, stem: Record<string, string> = {}): CatalogRow[] {
    return [
      {
        analysisId: 'ta-1',
        surfaceText: 'ἀρχῇ',
        form: 'ἀρχῇ',
        gloss: glosses.en ?? '',
        glosses,
        morphemes: [
          { ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el', gloss: stem },
        ],
        usageCount: 1,
        usageCountInBook: 1,
        usages: [],
        staleLocations: [],
        books: new Set(),
        searchText: '',
      },
    ];
  }

  const GLOSS = { language: 'en', analysisId: 'ta-1' };
  const STEM = { language: 'en', analysisId: 'ta-1', morphemeId: 'm-1' };

  it('keeps a draft whose gloss is still the one it was typed over', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    glossRetry.reject(GLOSS, { draft: 'beginning', typedOver: 'start' });

    glossRetry.prune(rows({ en: 'start' }));

    expect(glossRetry.draftFor(GLOSS, 'start')).toBe('beginning');
    expect(onHeldChange.mock.calls).toStrictEqual([[true]]);
  });

  it('drops a draft once its gloss has changed', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    glossRetry.reject(GLOSS, { draft: 'beginning', typedOver: 'start' });

    glossRetry.prune(rows({ en: 'origin' }));

    expect(glossRetry.draftFor(GLOSS, 'start')).toBeUndefined();
    expect(onHeldChange).toHaveBeenLastCalledWith(false);
  });

  it('drops a draft once its analysis is gone', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    glossRetry.reject(GLOSS, { draft: 'beginning', typedOver: 'start' });

    glossRetry.prune([]);

    expect(onHeldChange).toHaveBeenLastCalledWith(false);
  });

  it('checks a draft in another language against that language', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    const french = { language: 'fr', analysisId: 'ta-1' };
    glossRetry.reject(french, { draft: 'commencement', typedOver: 'début' });

    glossRetry.prune(rows({ en: 'start', fr: 'début' }));

    expect(glossRetry.draftFor(french, 'début')).toBe('commencement');
  });

  it('keeps a morpheme draft typed over no gloss while the morpheme still has none', () => {
    const glossRetry = createGlossRetry(jest.fn());
    glossRetry.reject(STEM, { draft: 'begin', typedOver: '' });

    glossRetry.prune(rows({ en: 'start' }));

    expect(glossRetry.draftFor(STEM, '')).toBe('begin');
  });

  it('drops a morpheme draft once its morpheme is gone', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    glossRetry.reject({ ...STEM, morphemeId: 'm-2' }, { draft: 'begin', typedOver: '' });

    glossRetry.prune(rows({ en: 'start' }));

    expect(onHeldChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a draft still held when another is dropped', () => {
    const onHeldChange = jest.fn();
    const glossRetry = createGlossRetry(onHeldChange);
    glossRetry.reject(GLOSS, { draft: 'beginning', typedOver: 'start' });
    glossRetry.reject(STEM, { draft: 'begin', typedOver: 'start' });

    glossRetry.prune(rows({ en: 'start' }, { en: 'stem' }));

    expect(glossRetry.draftFor(GLOSS, 'start')).toBe('beginning');
    expect(onHeldChange).toHaveBeenLastCalledWith(true);
  });
});
