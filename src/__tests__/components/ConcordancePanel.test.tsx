/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { Collator } from 'platform-bible-utils';
import { useEffect, type ReactNode } from 'react';
import { AnalysisStoreProvider, useGlossDispatch } from '../../components/AnalysisStore';
import { ConcordanceIndexContext } from '../../components/ConcordanceIndexContext';
import ConcordancePanel from '../../components/ConcordancePanel';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import type { ConcordanceIndex } from '../../hooks/useConcordanceIndex';
import { emptyAnalysis } from '../../types/empty-factories';
import { buildConcordanceEntries, indexBook } from '../../utils/concordance';
import { defaultScrRef, FIXTURE_STAMPS, makeScrollGroupHook, makeVerseBook } from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

// How reading progress and failure read is the status's own concern.
jest.mock('../../components/TextReadingStatus');

/**
 * The intersection-observer Jest stub exposes a helper for firing intersections on the global
 * object. Declared here so the windowing tests reach it without a type assertion.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var triggerIntersection: (el: Element, isIntersecting: boolean) => void;
}

/** The token the last focus request named, as claimed by {@link FocusRequestProbe}. */
let claimedFocusRequest: string | undefined;

/** Claims any focus request the panel raised for `bookCode`, standing in for the view. */
function FocusRequestProbe({ bookCode }: Readonly<{ bookCode: string }>) {
  const { consumeFocusRequest, focusRequestCount } = useInterlinearNav();
  useEffect(() => {
    claimedFocusRequest = consumeFocusRequest(bookCode);
  }, [bookCode, consumeFocusRequest, focusRequestCount]);
  return undefined;
}

/** Edits a token's gloss in the store the panel reads, standing in for the view beside it. */
let editGloss: (tokenRef: string, surfaceText: string, value: string) => void = () => {};

/** Publishes {@link editGloss}. */
function GlossEditProbe() {
  editGloss = useGlossDispatch();
  return undefined;
}

/** Genesis and Exodus, one verse each, "light" occurring in both. */
const ENTRIES = buildConcordanceEntries(
  [
    indexBook(makeVerseBook([{ sid: 'GEN 1:3', text: 'Let there be light' }])),
    indexBook(makeVerseBook([{ sid: 'EXO 10:23', text: 'had light' }])),
  ],
  new Collator('en'),
);

/** Builds an index as the loading hook hands it over, ready with {@link ENTRIES} by default. */
function makeIndex(overrides: Partial<ConcordanceIndex> = {}): ConcordanceIndex {
  return {
    status: 'ready',
    booksRead: 2,
    bookCount: 2,
    entries: ENTRIES,
    isPartial: false,
    textForms: undefined,
    refresh: () => {},
    request: () => {},
    ...overrides,
  };
}

/** Builds an approved link from `tokenRef` to the analysis. */
function link(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: 'light' },
  };
}

type PanelOptions = Partial<{
  index: ConcordanceIndex;
  analysis: TextAnalysis;
  currentBook: string;
  onClose: () => void;
  onShowCatalog: () => void;
  setScrRef: (ref: SerializedVerseRef) => void;
  /** Rendered inside the providers beside the panel, e.g. a probe writing to the store. */
  beside: ReactNode;
}>;

/** The panel inside a seeded analysis store and a real navigation provider. */
function panelTree(options: PanelOptions = {}) {
  return (
    <InterlinearNavProvider
      useWebViewScrollGroupScrRef={makeScrollGroupHook(defaultScrRef, options.setScrRef)}
    >
      <AnalysisStoreProvider
        analysisLanguage="en"
        initialAnalysis={options.analysis ?? emptyAnalysis()}
      >
        <FocusRequestProbe bookCode="EXO" />
        {options.beside}
        <ConcordanceIndexContext.Provider value={options.index ?? makeIndex()}>
          <ConcordancePanel
            currentBook={options.currentBook ?? 'GEN'}
            onClose={options.onClose ?? (() => {})}
            onShowCatalog={options.onShowCatalog ?? (() => {})}
            sourceLanguageTag="en"
          />
        </ConcordanceIndexContext.Provider>
      </AnalysisStoreProvider>
    </InterlinearNavProvider>
  );
}

function renderPanel(options: PanelOptions = {}) {
  return render(panelTree(options));
}

/** The row listing `form`. */
function rowFor(form: string): HTMLElement {
  const row = screen.getAllByTestId('concordance-row').find((r) => r.dataset.form === form);
  if (!row) throw new Error(`no row for "${form}"`);
  return row;
}

beforeEach(() => {
  mockKeyAsValueLocalizedStrings({
    '%interlinearizer_concordance_loading%': 'Reading {read} of {total}',
    '%interlinearizer_concordance_occurrenceCountInBook%': 'in {book}',
  });
  claimedFocusRequest = undefined;
});

describe('ConcordancePanel', () => {
  it('shows how far reading the books has got while the index is built', () => {
    renderPanel({ index: makeIndex({ status: 'loading', booksRead: 12, bookCount: 66 }) });

    expect(screen.getByTestId('text-reading-status')).toHaveTextContent('12 of 66');
    expect(screen.queryByTestId('concordance-row')).not.toBeInTheDocument();
  });

  it('says so when the books could not be listed', () => {
    renderPanel({ index: makeIndex({ status: 'error' }) });

    expect(screen.getByTestId('text-reading-status')).toHaveAttribute('data-status', 'error');
  });

  it('says so when the text has no words', () => {
    renderPanel({ index: makeIndex({ entries: [] }) });

    expect(screen.getByTestId('concordance-empty')).toHaveTextContent(
      '%interlinearizer_concordance_empty%',
    );
  });

  it('lists what was read beside a notice when a book failed to read', () => {
    renderPanel({ index: makeIndex({ isPartial: true }) });

    expect(screen.getByTestId('concordance-partial')).toHaveTextContent(
      '%interlinearizer_concordance_partial%',
    );
    expect(screen.getAllByTestId('concordance-row')).not.toHaveLength(0);
  });

  it('shows no partial-reading notice when every book was read', () => {
    renderPanel();

    expect(screen.queryByTestId('concordance-partial')).not.toBeInTheDocument();
  });

  it('lists every form of the text, most frequent first', () => {
    renderPanel();

    expect(screen.getAllByTestId('concordance-row').map((r) => r.dataset.form)).toEqual([
      'light',
      'be',
      'had',
      'let',
      'there',
    ]);
  });

  it('counts each form in the current book, naming the book', () => {
    renderPanel({ currentBook: 'EXO' });

    const count = within(rowFor('let')).getByTestId('concordance-row-count-in-book');
    expect(count).toHaveTextContent('0');
    expect(count).toHaveTextContent('in Exodus');
  });

  it('names the book in the interface language where the platform has a name for it', () => {
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_concordance_occurrenceCountInBook%': 'in {book}',
      '%LocalizedId.GEN%': 'Genèse',
    });
    renderPanel({ currentBook: 'GEN' });

    expect(within(rowFor('let')).getByTestId('concordance-row-count-in-book')).toHaveTextContent(
      'in Genèse',
    );
  });

  it('reads a form as analyzed where its occurrences carry approved analyses', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'a1', surfaceText: 'light' }],
      tokenAnalysisLinks: [link('a1', 'GEN 1:3:13')],
    };
    renderPanel({ analysis });

    expect(within(rowFor('light')).getByTestId('concordance-row-status')).toHaveAttribute(
      'data-status',
      'partlyAnalyzed',
    );
  });

  it('follows a gloss approved beside the panel', () => {
    renderPanel({ beside: <GlossEditProbe /> });

    act(() => editGloss('EXO 10:23:4', 'light', 'light'));

    expect(within(rowFor('light')).getByTestId('concordance-row-status')).toHaveAttribute(
      'data-status',
      'partlyAnalyzed',
    );
  });

  describe('jumping to an occurrence', () => {
    async function clickOccurrence(form: string, tokenRef: string): Promise<void> {
      await userEvent.click(within(rowFor(form)).getByTestId('concordance-row-toggle'));
      const occurrence = within(rowFor(form))
        .getAllByTestId('concordance-occurrence')
        .find((o) => o.dataset.tokenRef === tokenRef);
      if (!occurrence) throw new Error(`no occurrence "${tokenRef}"`);
      await userEvent.click(occurrence);
    }

    it('navigates to the verse the occurrence sits in', async () => {
      const setScrRef = jest.fn();
      renderPanel({ setScrRef });

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(setScrRef).toHaveBeenCalledWith(
        expect.objectContaining({ book: 'EXO', chapterNum: 10, verseNum: 23 }),
      );
    });

    it('asks for the occurrence itself to be focused', async () => {
      renderPanel();

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(claimedFocusRequest).toBe('EXO 10:23:4');
    });

    it('marks the row the jump came from', async () => {
      renderPanel();

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(rowFor('light')).toHaveAttribute('data-selected', 'true');
      expect(rowFor('had')).toHaveAttribute('data-selected', 'false');
    });
  });

  it('reads the text again on refresh', async () => {
    const refresh = jest.fn();
    renderPanel({ index: makeIndex({ refresh }) });

    await userEvent.click(screen.getByTestId('concordance-refresh'));

    expect(refresh).toHaveBeenCalled();
  });

  it('names the refresh action on hover', () => {
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_concordance_refresh%': 'Read the text again',
    });
    renderPanel();

    expect(screen.getByTestId('concordance-refresh')).toHaveAttribute(
      'title',
      'Read the text again',
    );
  });

  it('offers no refresh while the text is being read', () => {
    renderPanel({ index: makeIndex({ status: 'loading' }) });

    expect(screen.getByTestId('concordance-refresh')).toBeDisabled();
  });

  it('closes from its own close control', async () => {
    const onClose = jest.fn();
    renderPanel({ onClose });

    await userEvent.click(screen.getByTestId('concordance-close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('switches to the analysis catalog from its tab', async () => {
    const onShowCatalog = jest.fn();
    renderPanel({ onShowCatalog });

    await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

    expect(onShowCatalog).toHaveBeenCalled();
  });

  describe('with a long list', () => {
    const MANY = buildConcordanceEntries(
      [
        indexBook(
          makeVerseBook([
            {
              sid: 'GEN 1:1',
              text: Array.from({ length: 100 }, (_unused, index) => `w${index}`).join(' '),
            },
          ]),
        ),
      ],
      new Collator('en'),
    );

    it('mounts only part of it', () => {
      renderPanel({ index: makeIndex({ entries: MANY }) });

      const mounted = screen.getAllByTestId('concordance-row').length;
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThan(100);
    });

    it('mounts more as the end of what is mounted comes into view', () => {
      renderPanel({ index: makeIndex({ entries: MANY }) });
      const before = screen.getAllByTestId('concordance-row').length;

      act(() => {
        global.triggerIntersection(screen.getByTestId('concordance-rows-sentinel'), true);
      });

      expect(screen.getAllByTestId('concordance-row').length).toBeGreaterThan(before);
    });

    it('starts over at its first rows once a refresh has read the text again', () => {
      const { rerender } = renderPanel({ index: makeIndex({ entries: MANY }) });
      const initial = screen.getAllByTestId('concordance-row').length;
      act(() => {
        global.triggerIntersection(screen.getByTestId('concordance-rows-sentinel'), true);
      });

      rerender(panelTree({ index: makeIndex({ status: 'loading', entries: [] }) }));
      rerender(panelTree({ index: makeIndex({ entries: MANY }) }));

      expect(screen.getAllByTestId('concordance-row')).toHaveLength(initial);
    });
  });
});
