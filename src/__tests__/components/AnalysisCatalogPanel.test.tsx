/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { useEffect, useState, type ReactNode } from 'react';
import AnalysisCatalogPanel from '../../components/AnalysisCatalogPanel';
import { AnalysisStoreProvider, useGlossDispatch } from '../../components/AnalysisStore';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import { emptyAnalysis } from '../../types/empty-factories';
import { defaultScrRef, FIXTURE_STAMPS, makeScrollGroupHook } from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

/**
 * The intersection-observer Jest stub exposes a helper for firing intersections on the global
 * object. Declared here so the windowing tests reach it without a type assertion.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var triggerIntersection: (el: Element, isIntersecting: boolean) => void;
}

/**
 * Configures `useSetting` to report the given interface languages, most preferred first, for
 * `platform.interfaceLanguage` — the only setting the panel reads.
 *
 * @throws {Error} When `useSetting` is called with any other key (message: `useSetting mock:
 *   unexpected key "<key>"`).
 */
function mockInterfaceLanguage(interfaceLanguage: string[] = ['und']): void {
  jest.mocked(useSetting).mockImplementation((key: string) => {
    if (key === 'platform.interfaceLanguage')
      return [interfaceLanguage, jest.fn(), jest.fn(), false];
    throw new Error(`useSetting mock: unexpected key "${key}"`);
  });
}

/** Builds a link from `tokenRef` to the analysis, approved unless another status is given. */
function link(
  analysisId: string,
  tokenRef: string,
  status: AssignmentStatus = 'approved',
): TokenAnalysisLink {
  return { ...FIXTURE_STAMPS, analysisId, status, token: { tokenRef, surfaceText: 'word' } };
}

/** The token ref {@link FocusRequestProbe} last claimed, or `undefined` when it claimed nothing. */
let claimedFocusRequest: string | undefined;

/**
 * Claims whatever focus request the panel raised for `bookCode`, standing in for the interlinear
 * view, which claims one when the book it names is on screen. Publishes the claim rather than
 * rendering, so a test can read what the panel asked to be focused.
 */
function FocusRequestProbe({ bookCode }: Readonly<{ bookCode: string }>) {
  const { consumeFocusRequest, focusRequestCount } = useInterlinearNav();
  useEffect(() => {
    claimedFocusRequest = consumeFocusRequest(bookCode);
    // `focusRequestCount` is the only signal when a request names the verse already on screen.
  }, [bookCode, consumeFocusRequest, focusRequestCount]);
  return undefined;
}

/** Options every `renderPanel` call may override. */
type PanelOptions = Partial<{
  onClose: () => void;
  currentBook: string;
  analysis: TextAnalysis;
  analysisLanguage: string;
  /** Receives the analysis after every store write, so a test can assert on what was persisted. */
  onSave: (analysis: TextAnalysis) => void;
  /** Receives whether any edit is in progress, so a test can assert on the unsaved indicator. */
  onPendingEditsChange: (pending: boolean) => void;
  /** Records every reference the panel navigates to, through the host scroll-group hook. */
  setScrRef: (ref: SerializedVerseRef) => void;
  /** Reference the host scroll group reports, i.e. where the view already sits. */
  scrRef: SerializedVerseRef;
  /** Book the focus probe stands in for, i.e. the one the view has mounted. */
  mountedBook: string;
  /** Whether the project breaks words into morphemes. Defaults on, so the filter is under test. */
  showMorphology: boolean;
}>;

/**
 * Wraps a subject in the seeded analysis store and real navigation provider the panel needs.
 *
 * A navigation provider is remounted — losing the focus request it holds — by any change to the
 * element type above it, so a rerender that swaps the subject has to keep this wrapper in place
 * rather than rebuild an equivalent tree around it.
 */
function PanelProviders({
  children,
  overrides,
}: Readonly<{ children: ReactNode; overrides: PanelOptions }>) {
  return (
    <InterlinearNavProvider
      useWebViewScrollGroupScrRef={makeScrollGroupHook(
        overrides.scrRef ?? defaultScrRef,
        overrides.setScrRef,
      )}
    >
      <AnalysisStoreProvider
        analysisLanguage={overrides.analysisLanguage ?? 'en'}
        initialAnalysis={overrides.analysis ?? emptyAnalysis()}
        onPendingEditsChange={overrides.onPendingEditsChange}
        onSave={overrides.onSave}
      >
        <FocusRequestProbe bookCode={overrides.mountedBook ?? 'GEN'} />
        {children}
      </AnalysisStoreProvider>
    </InterlinearNavProvider>
  );
}

/** Renders the panel inside a seeded analysis store and a real navigation provider. */
function renderPanel(overrides: PanelOptions = {}) {
  return render(
    <PanelProviders overrides={overrides}>
      <AnalysisCatalogPanel
        currentBook={overrides.currentBook ?? 'GEN'}
        onClose={overrides.onClose ?? (() => {})}
        showMorphology={overrides.showMorphology ?? true}
        sourceLanguageTag="el"
      />
    </PanelProviders>,
  );
}

/**
 * The panel as the loader mounts it: conditionally rendered, so its own close control unmounts it
 * and reopening builds a fresh one. That arrangement is what makes the query controls ephemeral.
 */
function ReopenableCatalog() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button data-testid="reopen-catalog" onClick={() => setIsOpen(true)} type="button">
        reopen
      </button>
      {isOpen && (
        <AnalysisCatalogPanel
          currentBook="GEN"
          onClose={() => setIsOpen(false)}
          showMorphology
          sourceLanguageTag="el"
        />
      )}
    </>
  );
}

/** Renders the panel so a test can close and reopen it. */
function renderReopenablePanel(overrides: PanelOptions = {}) {
  return render(
    <PanelProviders overrides={overrides}>
      <ReopenableCatalog />
    </PanelProviders>,
  );
}

/**
 * Edits a token's gloss in the store the panel is reading, standing in for the interlinear view
 * beside it. Does nothing until {@link GlossEditProbe} has mounted.
 */
let editGloss: (tokenRef: string, surfaceText: string, value: string) => void = () => {};

/** Publishes {@link editGloss}, standing in for the view that writes glosses beside the panel. */
function GlossEditProbe() {
  editGloss = useGlossDispatch();
  return undefined;
}

/** Renders the panel beside a probe that can edit the analysis it is listing. */
function renderPanelWithGlossEditing(overrides: PanelOptions = {}) {
  return render(
    <PanelProviders overrides={overrides}>
      <GlossEditProbe />
      <AnalysisCatalogPanel
        currentBook={overrides.currentBook ?? 'GEN'}
        onClose={overrides.onClose ?? (() => {})}
        showMorphology={overrides.showMorphology ?? true}
        sourceLanguageTag="el"
      />
    </PanelProviders>,
  );
}

/** The ids of the rows the list is showing, in the order it shows them. */
function listedAnalysisIds(): (string | undefined)[] {
  return screen.getAllByTestId('catalog-row').map((row) => row.dataset.analysisId);
}

/**
 * The search input, located by its placeholder — the only accessible name the platform `SearchBar`
 * gives its input, which takes no `aria-label` and puts its `id` on its wrapper.
 */
function searchBox(): HTMLElement {
  return screen.getByPlaceholderText('%interlinearizer_analysisCatalog_searchPlaceholder%');
}

/** Opens the filter popover, whose controls are mounted only while it is open. */
async function openFilters(): Promise<void> {
  await userEvent.click(screen.getByTestId('catalog-filters-button'));
}

/** Reads the catalog row for `analysisId`, failing the test when the list has no such row. */
function rowFor(analysisId: string): HTMLElement {
  const row = screen
    .getAllByTestId('catalog-row')
    .find((candidate) => candidate.dataset.analysisId === analysisId);
  if (!row) throw new Error(`no catalog row for "${analysisId}"`);
  return row;
}

describe('AnalysisCatalogPanel', () => {
  beforeEach(() => {
    claimedFocusRequest = undefined;
    editGloss = () => {};
    mockKeyAsValueLocalizedStrings();
    mockInterfaceLanguage();
  });

  describe('rows', () => {
    it('says the catalog is empty rather than leaving the panel blank', () => {
      // A draft records nothing until the first gloss is entered, so the empty catalog is what most
      // readers open the panel to.
      renderPanel({ analysis: emptyAnalysis() });

      expect(screen.queryAllByTestId('catalog-row')).toHaveLength(0);
      expect(screen.getByTestId('analysis-catalog-panel')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_empty%',
      );
    });

    it('announces the empty catalog rather than leaving it to be noticed', () => {
      renderPanel({ analysis: emptyAnalysis() });

      expect(screen.getByRole('status')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_empty%',
      );
    });

    it('offers no query controls over a draft that has recorded nothing', () => {
      // Every control would narrow an empty listing, and a filter popover over nothing is an
      // invitation to a dead end.
      renderPanel({ analysis: emptyAnalysis() });

      expect(screen.queryByTestId('catalog-sort')).not.toBeInTheDocument();
      expect(screen.queryByTestId('catalog-filters-button')).not.toBeInTheDocument();
    });

    it('keeps the query controls when a query rather than the draft emptied the listing', async () => {
      // The controls are the only way back to a listing a query has narrowed away, so the case that
      // looks emptiest is the one that most needs them.
      renderPanel({
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [
            { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
          ],
          tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
        },
      });

      await userEvent.type(searchBox(), 'ζζζ');

      expect(screen.getByTestId('analysis-catalog-panel')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_noMatches%',
      );
      expect(screen.getByTestId('catalog-sort')).toBeInTheDocument();
      expect(screen.getByTestId('catalog-filters-button')).toBeInTheDocument();
    });

    it('renders an analysis with its gloss and its usage counts inside and outside the book', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
        ],
        tokenAnalysisLinks: [
          link('ta-1', 'GEN 1:1:0'),
          link('ta-1', 'GEN 1:2:4'),
          link('ta-1', 'EXO 3:14:8'),
        ],
      };
      renderPanel({ analysis, currentBook: 'GEN' });

      const row = within(rowFor('ta-1'));
      expect(row.getByTestId('catalog-row-surface')).toHaveTextContent('λόγος');
      expect(row.getByTestId('catalog-row-gloss')).toHaveTextContent('word');
      expect(row.getByTestId('catalog-row-usage-count')).toHaveTextContent('3');
      expect(row.getByTestId('catalog-row-usage-count-in-book')).toHaveTextContent('2');
    });

    it('leads with the most-used analysis', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'rare', surfaceText: 'ἀρχῇ' },
          { ...FIXTURE_STAMPS, id: 'common', surfaceText: 'λόγος' },
        ],
        tokenAnalysisLinks: [
          link('rare', 'GEN 1:1:0'),
          link('common', 'GEN 1:2:0'),
          link('common', 'GEN 1:3:0'),
        ],
      };
      renderPanel({ analysis });

      expect(screen.getAllByTestId('catalog-row').map((row) => row.dataset.analysisId)).toEqual([
        'common',
        'rare',
      ]);
    });

    it('lists the rows under an analysis language Intl cannot parse', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };

      // Analysis languages are free text from the project modals, so a hand-typed tag reaches the
      // sort's collator unchecked. Throwing here would take the whole view down with it.
      renderPanel({ analysis, analysisLanguage: 'en_US' });

      expect(within(rowFor('ta-1')).getByTestId('catalog-row-surface')).toHaveTextContent('λόγος');
    });

    it('leaves the row toggle unlabeled so that its own content names it', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      // An accessible name on a button overrides everything inside it, so labeling the row would
      // leave every row announced alike and the analysis itself unread.
      expect(within(rowFor('ta-1')).getByTestId('catalog-row-toggle')).not.toHaveAttribute(
        'aria-label',
      );
    });

    it('spells out what each usage count means for assistive tech', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis, currentBook: 'GEN' });

      // The counts render as bare numerals, and their `title` is not announced on a span.
      const row = within(rowFor('ta-1'));
      expect(row.getByTestId('catalog-row-usage-count')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_usageCount%',
      );
      expect(row.getByTestId('catalog-row-usage-count-in-book')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_usageCountInBook%',
      );
    });

    it('names the book the per-book count is taken against rather than showing its code', () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_usageCountInBook%': 'Uses in {book}',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis, currentBook: 'GEN' });

      expect(
        within(rowFor('ta-1')).getByTestId('catalog-row-usage-count-in-book'),
      ).toHaveTextContent('Uses in Genesis');
    });

    it('names the book in the interface language where the platform has a name for it', () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_usageCountInBook%': 'Uses in {book}',
        '%LocalizedId.GEN%': 'Genèse',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis, currentBook: 'GEN' });

      expect(
        within(rowFor('ta-1')).getByTestId('catalog-row-usage-count-in-book'),
      ).toHaveTextContent('Uses in Genèse');
    });

    it('marks an analysis with no gloss in the active language rather than leaving the cell blank', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        // A gloss in another language is still no gloss here: the row displays the active one.
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { fr: 'parole' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis, analysisLanguage: 'en' });

      // The mocked hook yields raw keys, standing in for PAPI's async localization window.
      expect(within(rowFor('ta-1')).getByTestId('catalog-row-gloss')).toHaveTextContent('—');
    });

    it('marks an analysis with no gloss using the localized placeholder once it resolves', () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_noGloss%': '(no gloss)',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { fr: 'parole' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis, analysisLanguage: 'en' });

      expect(within(rowFor('ta-1')).getByTestId('catalog-row-gloss')).toHaveTextContent(
        '(no gloss)',
      );
    });

    it('offers the surface form and gloss in full, both being truncated to one line', () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      // The tooltip stub projects its content onto the trigger, hover having no jsdom equivalent.
      const row = within(rowFor('ta-1'));
      expect(row.getByTestId('catalog-row-surface')).toHaveAttribute('title', 'λόγος');
      expect(row.getByTestId('catalog-row-gloss')).toHaveAttribute('title', 'word');
    });
  });

  describe('searching', () => {
    /** Two analyses sharing no letter, so any query separates them. */
    const TWO_WORDS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'logos', surfaceText: 'λόγος', gloss: { en: 'word' } },
        { ...FIXTURE_STAMPS, id: 'arche', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
      ],
      tokenAnalysisLinks: [link('logos', 'GEN 1:1:0'), link('arche', 'GEN 1:2:0')],
    };

    it('narrows the list to the analyses a query matches', async () => {
      renderPanel({ analysis: TWO_WORDS });

      await userEvent.type(searchBox(), 'begin');

      expect(listedAnalysisIds()).toEqual(['arche']);
    });

    it('forgets the query when the panel is closed and reopened', async () => {
      renderReopenablePanel({ analysis: TWO_WORDS });
      await userEvent.type(searchBox(), 'begin');

      await userEvent.click(screen.getByTestId('analysis-catalog-close'));
      await userEvent.click(screen.getByTestId('reopen-catalog'));

      // A query that outlived the panel would reopen it onto a part of the list with nothing on
      // screen saying which part, so the state is deliberately tied to the mount.
      expect(searchBox()).toHaveValue('');
      expect(listedAnalysisIds()).toEqual(['arche', 'logos']);
    });

    it('says the query matched nothing rather than that the draft holds nothing', async () => {
      renderPanel({ analysis: TWO_WORDS });

      await userEvent.type(searchBox(), 'ζζζ');

      const panel = screen.getByTestId('analysis-catalog-panel');
      expect(panel).toHaveTextContent('%interlinearizer_analysisCatalog_noMatches%');
      expect(panel).not.toHaveTextContent('%interlinearizer_analysisCatalog_empty%');
    });
  });

  describe('sorting', () => {
    /**
     * Three analyses whose usage order and gloss order disagree at every position, so a reorder
     * cannot pass by coincidence.
     */
    const THREE: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'once', surfaceText: 'γῆ', gloss: { en: 'apple' } },
        { ...FIXTURE_STAMPS, id: 'thrice', surfaceText: 'λόγος', gloss: { en: 'cherry' } },
        { ...FIXTURE_STAMPS, id: 'twice', surfaceText: 'ἀρχῇ', gloss: { en: 'banana' } },
      ],
      tokenAnalysisLinks: [
        link('once', 'GEN 1:1:0'),
        link('twice', 'GEN 1:2:0'),
        link('twice', 'GEN 1:3:0'),
        link('thrice', 'GEN 1:4:0'),
        link('thrice', 'GEN 1:5:0'),
        link('thrice', 'GEN 1:6:0'),
      ],
    };

    it('reorders the rows when a different sort is chosen', async () => {
      renderPanel({ analysis: THREE });
      expect(listedAnalysisIds()).toEqual(['thrice', 'twice', 'once']);

      await userEvent.click(screen.getByTestId('catalog-sort-gloss'));

      expect(listedAnalysisIds()).toEqual(['once', 'twice', 'thrice']);
    });

    it('names the book the per-book sort is taken against rather than showing its code', () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_sort_usageCountInBook%': 'Most used in {book}',
      });
      // The panel is given a book code, so an option reading "Most used in GEN" is the failure the
      // resolved name is asserted against.
      renderPanel({ analysis: THREE, currentBook: 'GEN' });

      expect(screen.getByTestId('catalog-sort-usageCountInBook')).toHaveTextContent(
        'Most used in Genesis',
      );
    });
  });

  describe('filtering', () => {
    /** One analysis used only in GEN and one used only in EXO, so a book choice separates them. */
    const PER_BOOK: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'in-gen', surfaceText: 'γῆ' },
        { ...FIXTURE_STAMPS, id: 'in-exo', surfaceText: 'λόγος' },
      ],
      tokenAnalysisLinks: [link('in-gen', 'GEN 1:1:0'), link('in-exo', 'EXO 3:14:0')],
    };

    it('narrows the list to the analyses used in a chosen book', async () => {
      renderPanel({ analysis: PER_BOOK });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));

      expect(listedAnalysisIds()).toEqual(['in-exo']);
    });

    it('restores the full list when the last book choice is cleared', async () => {
      renderPanel({ analysis: PER_BOOK });
      await openFilters();
      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));

      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));

      // An empty selection reads as no filter at all rather than as one nothing satisfies, so
      // deselecting the last choice is how a reader gets the whole draft back.
      expect(listedAnalysisIds()).toEqual(['in-gen', 'in-exo']);
    });

    it('releases a chosen book the draft has since stopped using', async () => {
      const analysis: TextAnalysis = {
        ...PER_BOOK,
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'in-gen', surfaceText: 'γῆ' },
          // Its gloss is the whole of its content, so clearing that empties the analysis and the
          // draft stops covering EXO at all.
          { ...FIXTURE_STAMPS, id: 'in-exo', surfaceText: 'λόγος', gloss: { en: 'word' } },
        ],
      };
      renderPanelWithGlossEditing({ analysis });
      await openFilters();
      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));

      act(() => editGloss('EXO 3:14:0', 'λόγος', ''));

      // The books facet is down to one choice and offers none of its own, so the selection it was
      // narrowing by is spent rather than left on screen to be cleared by hand.
      expect(screen.queryByRole('option', { name: 'EXO' })).not.toBeInTheDocument();
    });

    it('restores the list when a chosen book the draft stopped using is withdrawn', async () => {
      const analysis: TextAnalysis = {
        ...PER_BOOK,
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'in-gen', surfaceText: 'γῆ' },
          { ...FIXTURE_STAMPS, id: 'in-exo', surfaceText: 'λόγος', gloss: { en: 'word' } },
        ],
      };
      renderPanelWithGlossEditing({ analysis });
      await openFilters();
      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));

      act(() => editGloss('EXO 3:14:0', 'λόγος', ''));

      // Releasing the filter has to widen the list on its own, or the reader is left with an empty
      // list and no way back to the draft.
      expect(listedAnalysisIds()).toEqual(['in-gen']);
    });

    it('tells a recorded value apart from the choice named for carrying none', async () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_untagged%': '(none)',
        '%interlinearizer_analysisCatalog_filter_recordedValue%': '{value} (recorded value)',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          // A part of speech spelled exactly like the label the untagged choice carries.
          { ...FIXTURE_STAMPS, id: 'named', surfaceText: 'λόγος', pos: '(none)' },
          { ...FIXTURE_STAMPS, id: 'untagged', surfaceText: 'ἦν' },
        ],
        tokenAnalysisLinks: [link('named', 'GEN 1:1:0'), link('untagged', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: '(none)' }));

      // Two choices sharing a label leave one of them unselectable, so a value that reads as the
      // untagged label has to be told apart from it.
      expect(listedAnalysisIds()).toEqual(['untagged']);
      expect(screen.getByRole('option', { name: '(none) (recorded value)' })).toBeInTheDocument();
    });

    it('tells a recorded value apart from another value already marked as recorded', async () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_untagged%': '(none)',
        '%interlinearizer_analysisCatalog_filter_recordedValue%': '{value} (recorded value)',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          // A part of speech spelled like the untagged label, beside one spelled like the marking
          // that tells it apart.
          { ...FIXTURE_STAMPS, id: 'plain', surfaceText: 'λόγος', pos: '(none)' },
          {
            ...FIXTURE_STAMPS,
            id: 'marked',
            surfaceText: 'ἦν',
            pos: '(none) (recorded value)',
          },
        ],
        tokenAnalysisLinks: [link('plain', 'GEN 1:1:0'), link('marked', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // The value recorded verbatim keeps this spelling, so this is the option a single marking
      // would have collided with.
      await userEvent.click(screen.getByRole('option', { name: '(none) (recorded value)' }));

      expect(listedAnalysisIds()).toEqual(['marked']);
    });

    it('offers a value recorded with surrounding whitespace under a name that can be chosen', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          // A part of speech is free-form and reaches the draft as its source system recorded it,
          // so it can carry whitespace the control trims off the name it reports back — leaving a
          // choice the control cannot resolve unless it was offered under the trimmed spelling.
          { ...FIXTURE_STAMPS, id: 'padded', surfaceText: 'λόγος', pos: ' noun ' },
          { ...FIXTURE_STAMPS, id: 'verb', surfaceText: 'ἦν', pos: 'verb' },
        ],
        tokenAnalysisLinks: [link('padded', 'GEN 1:1:0'), link('verb', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: 'noun' }));

      expect(listedAnalysisIds()).toEqual(['padded']);
    });

    it('offers a marking that pads what it wraps under a name that can be chosen', async () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_recordedValue%': '  {value} (recorded value)  ',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          // These agree once trimmed, so one has to be marked. Choices are offered in the order the
          // values sort in, where the leading space sorts first — leaving the padded value under
          // the plain name and this one under the marking.
          { ...FIXTURE_STAMPS, id: 'plain', surfaceText: 'λόγος', pos: 'noun' },
          { ...FIXTURE_STAMPS, id: 'padded', surfaceText: 'ἦν', pos: ' noun ' },
        ],
        tokenAnalysisLinks: [link('plain', 'GEN 1:1:0'), link('padded', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: 'noun (recorded value)' }));

      expect(listedAnalysisIds()).toEqual(['plain']);
    });

    it('tells a value recorded as whitespace apart from one recorded as empty', async () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_empty%': '(empty)',
        '%interlinearizer_analysisCatalog_filter_recordedValue%': '{value} (recorded value)',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'blank', surfaceText: 'λόγος', pos: '' },
          // Nothing is left of this once trimmed, so it has no name of its own to be offered under.
          { ...FIXTURE_STAMPS, id: 'spaces', surfaceText: 'ἦν', pos: '   ' },
        ],
        tokenAnalysisLinks: [link('blank', 'GEN 1:1:0'), link('spaces', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: '(empty) (recorded value)' }));

      expect(listedAnalysisIds()).toEqual(['spaces']);
    });

    it('stops marking a value rather than spinning when the marking cannot tell it apart', async () => {
      // A localization that drops `{value}` leaves the marking spelling whatever name it was given,
      // so repeating it can never clear a collision. Two choices then share a name and one of them
      // is unselectable — but the panel renders, where a render that never returns takes the whole
      // WebView down with it.
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_untagged%': '(none)',
        '%interlinearizer_analysisCatalog_filter_recordedValue%': '{value}',
      });
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'named', surfaceText: 'λόγος', pos: '(none)' },
          { ...FIXTURE_STAMPS, id: 'untagged', surfaceText: 'ἦν' },
        ],
        tokenAnalysisLinks: [link('named', 'GEN 1:1:0'), link('untagged', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });

      await openFilters();

      expect(screen.getAllByRole('option', { name: '(none)' })).toHaveLength(2);
    });

    it('names the language the missing-gloss filter asks about, in the interface language', async () => {
      mockInterfaceLanguage(['es']);
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filter_missingGloss%': 'Missing gloss in {language}',
      });
      renderPanel({ analysis: PER_BOOK, analysisLanguage: 'fr' });

      await openFilters();

      // A reader who never chose the tag has no reason to recognize it, and a name taken from the
      // host's own locale would read in one language beside a label resolved in another — the
      // platform's interface language being a setting the host locale does not follow.
      expect(
        screen.getByRole('checkbox', { name: 'Missing gloss in francés' }),
      ).toBeInTheDocument();
    });

    it('narrows the list to the analyses carrying a chosen part of speech', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'noun', surfaceText: 'λόγος', pos: 'noun' },
          { ...FIXTURE_STAMPS, id: 'verb', surfaceText: 'ἦν', pos: 'verb' },
        ],
        tokenAnalysisLinks: [link('noun', 'GEN 1:1:0'), link('verb', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: 'verb' }));

      expect(listedAnalysisIds()).toEqual(['verb']);
    });

    it('narrows the list to the analyses carrying no part of speech at all', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'tagged', surfaceText: 'λόγος', pos: 'noun' },
          { ...FIXTURE_STAMPS, id: 'untagged', surfaceText: 'ἦν' },
        ],
        tokenAnalysisLinks: [link('tagged', 'GEN 1:1:0'), link('untagged', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // Carrying no value is a choice of its own, which is what lets a reader ask which analyses
      // still need the field rather than only which already carry a given value.
      await userEvent.click(
        screen.getByRole('option', {
          name: '%interlinearizer_analysisCatalog_filter_untagged%',
        }),
      );

      expect(listedAnalysisIds()).toEqual(['untagged']);
    });

    it('narrows the list to the analyses carrying a chosen confidence', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'sure', surfaceText: 'λόγος', confidence: 'high' },
          { ...FIXTURE_STAMPS, id: 'unsure', surfaceText: 'ἦν', confidence: 'guess' },
        ],
        tokenAnalysisLinks: [link('sure', 'GEN 1:1:0'), link('unsure', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // Confidence is a closed vocabulary, so unlike a part of speech it is offered under a
      // localized name rather than under the value the record stores.
      await userEvent.click(
        screen.getByRole('option', {
          name: '%interlinearizer_analysisCatalog_confidence_guess%',
        }),
      );

      expect(listedAnalysisIds()).toEqual(['unsure']);
    });

    it('narrows the list to the analyses carrying a chosen value of a named feature', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          {
            ...FIXTURE_STAMPS,
            id: 'nom',
            surfaceText: 'λόγος',
            features: { case: 'nominative' },
          },
          { ...FIXTURE_STAMPS, id: 'gen', surfaceText: 'λόγου', features: { case: 'genitive' } },
        ],
        tokenAnalysisLinks: [link('nom', 'GEN 1:1:0'), link('gen', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // A feature's name and values are both free text out of the data, so each named feature
      // raises its own control, under its own name.
      await userEvent.click(screen.getByRole('option', { name: 'genitive' }));

      expect(listedAnalysisIds()).toEqual(['gen']);
    });

    it('narrows the list to the analyses carrying a feature value that is the empty string', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'blank', surfaceText: 'λόγος', features: { case: '' } },
          { ...FIXTURE_STAMPS, id: 'gen', surfaceText: 'λόγου', features: { case: 'genitive' } },
        ],
        tokenAnalysisLinks: [link('blank', 'GEN 1:1:0'), link('gen', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // Feature values are free text, so one may be the empty string, which the control can
      // neither label nor carry as itself.
      const feature = within(screen.getByTestId('catalog-filter-feature-case'));
      await userEvent.click(
        feature.getByRole('option', {
          name: '%interlinearizer_analysisCatalog_filter_empty%',
        }),
      );

      expect(listedAnalysisIds()).toEqual(['blank']);
    });

    // The platform combo box resolves a click by matching the label back to its entry, so a real
    // value reading exactly as the untagged placeholder would otherwise take that choice's clicks.
    /** Two analyses in two books, so the books facet is offered and one edit can collapse it. */
    const TWO_BOOKS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'in-gen', surfaceText: 'λόγος', gloss: { en: 'word' } },
        { ...FIXTURE_STAMPS, id: 'in-exo', surfaceText: 'ἦν', gloss: { en: 'was' } },
      ],
      tokenAnalysisLinks: [link('in-gen', 'GEN 1:1:0'), link('in-exo', 'EXO 1:1:0')],
    };

    // An edit beside the panel can remove the last row carrying a chosen value, which takes that
    // facet's control off screen. Holding the choice would narrow the list to nothing with no
    // control left to widen it back by.
    it('releases a book filter once an edit leaves that facet with nothing to offer', async () => {
      renderPanelWithGlossEditing({ analysis: TWO_BOOKS, analysisLanguage: 'en' });
      await openFilters();
      const books = within(screen.getByTestId('catalog-filter-books'));
      await userEvent.click(books.getByRole('option', { name: 'EXO' }));
      expect(listedAnalysisIds()).toEqual(['in-exo']);

      // Clearing its only gloss empties the payload, which drops the analysis and its link.
      act(() => editGloss('EXO 1:1:0', 'ἦν', ''));

      expect(listedAnalysisIds()).toEqual(['in-gen']);
    });

    // A withdrawn choice is spent, not merely unused: held, it would come back with its facet and
    // narrow the listing by a filter the reader had already watched release.
    it('leaves a released book filter released once the edge that withdrew it is undone', async () => {
      renderPanelWithGlossEditing({ analysis: TWO_BOOKS, analysisLanguage: 'en' });
      await openFilters();
      const books = within(screen.getByTestId('catalog-filter-books'));
      await userEvent.click(books.getByRole('option', { name: 'EXO' }));
      act(() => editGloss('EXO 1:1:0', 'ἦν', ''));
      expect(listedAnalysisIds()).toEqual(['in-gen']);

      // Glossing it again analyzes the token afresh — a new payload under a new id, so the restored
      // row is matched on count rather than named — and raises the books facet that offers EXO.
      act(() => editGloss('EXO 1:1:0', 'ἦν', 'was'));

      expect(listedAnalysisIds()).toHaveLength(2);
      expect(listedAnalysisIds()).toContain('in-gen');
    });

    it('stops counting a filter the facets have withdrawn as active', async () => {
      renderPanelWithGlossEditing({ analysis: TWO_BOOKS, analysisLanguage: 'en' });
      await openFilters();
      const books = within(screen.getByTestId('catalog-filter-books'));
      await userEvent.click(books.getByRole('option', { name: 'EXO' }));

      act(() => editGloss('EXO 1:1:0', 'ἦν', ''));

      expect(screen.getByTestId('catalog-filters-button')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_filters%',
      );
    });

    it('tells the untagged choice apart from a value that reads the same', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          {
            ...FIXTURE_STAMPS,
            id: 'named',
            surfaceText: 'λόγος',
            pos: '%interlinearizer_analysisCatalog_filter_untagged%',
          },
          { ...FIXTURE_STAMPS, id: 'untagged', surfaceText: 'ἦν' },
        ],
        tokenAnalysisLinks: [link('named', 'GEN 1:1:0'), link('untagged', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      // The untagged choice keeps the plain label and the value reading the same is marked as a
      // recorded value, so an exact match on the label reaches the choice rather than the value.
      const pos = within(screen.getByTestId('catalog-filter-pos'));
      await userEvent.click(
        pos.getByRole('option', { name: '%interlinearizer_analysisCatalog_filter_untagged%' }),
      );

      expect(listedAnalysisIds()).toEqual(['untagged']);
    });

    it('offers no book choice for a draft confined to one book', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'γῆ' },
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'λόγος' },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:2:0')],
      };
      renderPanel({ analysis });

      await openFilters();

      // One book is the state every row is already in, so choosing it would narrow nothing.
      expect(
        within(screen.getByTestId('catalog-filters-panel')).queryByTestId('catalog-filter-books'),
      ).not.toBeInTheDocument();
    });

    it('offers no choices for the fields nothing has recorded', async () => {
      renderPanel({ analysis: PER_BOOK });

      await openFilters();

      // No write path records a part of speech, a confidence, or a feature yet, so every row is
      // untagged for each of them and the facets are rightly absent rather than offering "(none)"
      // alone — the tested-for outcome, not a gap in the controls.
      const panel = within(screen.getByTestId('catalog-filters-panel'));
      expect(panel.queryByTestId('catalog-filter-pos')).not.toBeInTheDocument();
      expect(panel.queryByTestId('catalog-filter-confidence')).not.toBeInTheDocument();
      expect(panel.queryAllByTestId(/^catalog-filter-feature-/)).toHaveLength(0);
    });

    it('narrows the list to the analyses with no gloss in the active language', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'glossed', surfaceText: 'λόγος', gloss: { en: 'word' } },
          // A gloss in another language is no gloss here: the filter reads the active one.
          { ...FIXTURE_STAMPS, id: 'elsewhere', surfaceText: 'ἦν', gloss: { fr: 'était' } },
        ],
        tokenAnalysisLinks: [link('glossed', 'GEN 1:1:0'), link('elsewhere', 'GEN 1:2:0')],
      };
      renderPanel({ analysis, analysisLanguage: 'en' });
      await openFilters();

      await userEvent.click(
        screen.getByRole('checkbox', {
          name: '%interlinearizer_analysisCatalog_filter_missingGloss%',
        }),
      );

      expect(listedAnalysisIds()).toEqual(['elsewhere']);
    });

    /** One analysis broken into morphemes and one not, so the breakdown filter separates them. */
    const PER_BREAKDOWN: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          ...FIXTURE_STAMPS,
          id: 'analyzed',
          surfaceText: 'λόγος',
          morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' }],
        },
        { ...FIXTURE_STAMPS, id: 'whole', surfaceText: 'ἦν' },
      ],
      tokenAnalysisLinks: [link('analyzed', 'GEN 1:1:0'), link('whole', 'GEN 1:2:0')],
    };

    it('narrows the list to the analyses carrying a morpheme breakdown', async () => {
      renderPanel({ analysis: PER_BREAKDOWN });
      await openFilters();

      await userEvent.click(screen.getByTestId('catalog-filter-morphemes-has'));

      expect(listedAnalysisIds()).toEqual(['analyzed']);
    });

    it('narrows the list to the analyses carrying no morpheme breakdown', async () => {
      renderPanel({ analysis: PER_BREAKDOWN });
      await openFilters();

      await userEvent.click(screen.getByTestId('catalog-filter-morphemes-lacks'));

      expect(listedAnalysisIds()).toEqual(['whole']);
    });

    it('restores the full list when the breakdown filter is set back to either', async () => {
      renderPanel({ analysis: PER_BREAKDOWN });
      await openFilters();
      await userEvent.click(screen.getByTestId('catalog-filter-morphemes-has'));

      await userEvent.click(screen.getByTestId('catalog-filter-morphemes-any'));

      // Ordered by form under the source language's collation, eta before lambda.
      expect(listedAnalysisIds()).toEqual(['whole', 'analyzed']);
    });

    it('offers no breakdown filter to a project that does not break words into morphemes', async () => {
      renderPanel({ analysis: PER_BREAKDOWN, showMorphology: false });

      await openFilters();

      expect(screen.queryByTestId('catalog-filter-morphemes')).not.toBeInTheDocument();
    });

    it('keeps the breakdown filter while it narrows the list, morphology off', async () => {
      // Turning the setting off behind a filter already set would otherwise leave the list narrowed
      // with no control on screen to clear it by.
      const { rerender } = renderPanel({ analysis: PER_BREAKDOWN });
      await openFilters();
      await userEvent.click(screen.getByTestId('catalog-filter-morphemes-has'));

      rerender(
        <PanelProviders overrides={{ analysis: PER_BREAKDOWN }}>
          <AnalysisCatalogPanel
            currentBook="GEN"
            onClose={() => {}}
            showMorphology={false}
            sourceLanguageTag="el"
          />
        </PanelProviders>,
      );

      expect(screen.getByTestId('catalog-filter-morphemes')).toBeInTheDocument();
      expect(listedAnalysisIds()).toEqual(['analyzed']);
    });

    it('keeps only the analyses nothing uses', async () => {
      // Built by hand because no write path produces an unused analysis: detaching the last link
      // drops the payload with it.
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'used', surfaceText: 'λόγος' },
          { ...FIXTURE_STAMPS, id: 'unused', surfaceText: 'ἦν' },
        ],
        tokenAnalysisLinks: [link('used', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });
      await openFilters();

      await userEvent.click(
        screen.getByRole('checkbox', {
          name: '%interlinearizer_analysisCatalog_filter_zeroUsages%',
        }),
      );

      expect(listedAnalysisIds()).toEqual(['unused']);
    });

    it('says how many filters are narrowing the list', async () => {
      // The count is the only thing on screen saying the list is narrowed once the popover is
      // closed again, so it is resolved for real rather than as its own key.
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_analysisCatalog_filtersActive%': 'Filters ({count})',
      });
      renderPanel({ analysis: PER_BOOK });
      await openFilters();

      await userEvent.click(screen.getByRole('option', { name: 'EXO' }));
      await userEvent.click(
        screen.getByRole('checkbox', {
          name: '%interlinearizer_analysisCatalog_filter_missingGloss%',
        }),
      );

      expect(screen.getByTestId('catalog-filters-button')).toHaveTextContent('Filters (2)');
    });

    it('names the filter control alone while nothing is narrowing the list', async () => {
      renderPanel({ analysis: PER_BOOK });

      await openFilters();

      expect(screen.getByTestId('catalog-filters-button')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_filters%',
      );
    });
  });

  describe('windowing the list', () => {
    /** Far more analyses than a panel could ever show at once. */
    const MANY: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: Array.from({ length: 100 }, (_unused, index) => ({
        ...FIXTURE_STAMPS,
        id: `ta-${index}`,
        surfaceText: `word${index}`,
      })),
      tokenAnalysisLinks: Array.from({ length: 100 }, (_unused, index) =>
        link(`ta-${index}`, `GEN 1:${index + 1}:0`),
      ),
    };

    /** The scrolling list, reached through the sentinel it holds as its last child. */
    function rowList(): HTMLElement {
      const list = screen.getByTestId('catalog-rows-sentinel').parentElement;
      if (!list) throw new Error('the row sentinel is outside a list');
      return list;
    }

    /** Reports the end of the list as having come into view. */
    function reachListEnd(): void {
      act(() => {
        global.triggerIntersection(screen.getByTestId('catalog-rows-sentinel'), true);
      });
    }

    it('mounts only part of a long list', () => {
      renderPanel({ analysis: MANY });

      // A draft accumulates analyses without bound, and every row carries its own expander and
      // usage list, so the whole listing is never in the document at once.
      const mounted = screen.getAllByTestId('catalog-row').length;
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThan(100);
    });

    it('extends the window when the end of the list comes into view', () => {
      renderPanel({ analysis: MANY });
      const before = screen.getAllByTestId('catalog-row').length;

      reachListEnd();

      expect(screen.getAllByTestId('catalog-row').length).toBeGreaterThan(before);
    });

    it('starts the window over when the query changes', async () => {
      renderPanel({ analysis: MANY });
      reachListEnd();
      const grown = screen.getAllByTestId('catalog-row').length;

      // Matches every row, so the listing is the same length as before — only the window resets.
      await userEvent.type(searchBox(), 'word');

      expect(screen.getAllByTestId('catalog-row').length).toBeLessThan(grown);
    });

    it('returns the list to its top when the query changes', async () => {
      renderPanel({ analysis: MANY });
      const list = rowList();
      list.scrollTop = 500;

      // Matches every row, so the listing is the same length as before — only the window resets.
      await userEvent.type(searchBox(), 'word');

      // The list is the same element throughout, so it holds the offset it was left at until it is
      // put back, landing a reader who narrowed a deeply scrolled list part way down a new one.
      expect(list.scrollTop).toBe(0);
    });

    it('leaves the scroll where it is when the analysis changes under an unchanged query', () => {
      renderPanelWithGlossEditing({ analysis: MANY });
      const list = rowList();
      list.scrollTop = 500;

      act(() => editGloss('GEN 1:1:0', 'word0', 'beginning'));

      expect(list.scrollTop).toBe(500);
    });

    it('starts the window over when the book changes', () => {
      const { rerender } = renderPanel({ analysis: MANY, currentBook: 'GEN' });
      reachListEnd();
      const grown = screen.getAllByTestId('catalog-row').length;

      rerender(
        <PanelProviders overrides={{ analysis: MANY, currentBook: 'MAT' }}>
          <AnalysisCatalogPanel
            currentBook="MAT"
            onClose={() => {}}
            showMorphology
            sourceLanguageTag="el"
          />
        </PanelProviders>,
      );

      expect(screen.getAllByTestId('catalog-row').length).toBeLessThan(grown);
    });

    it('returns the list to its top when the book changes', () => {
      // The per-book count each row is ranked and labeled by is taken against the book on screen,
      // so moving to another one is a new listing however the reader left the query.
      const { rerender } = renderPanel({ analysis: MANY, currentBook: 'GEN' });
      const list = rowList();
      list.scrollTop = 500;

      rerender(
        <PanelProviders overrides={{ analysis: MANY, currentBook: 'MAT' }}>
          <AnalysisCatalogPanel
            currentBook="MAT"
            onClose={() => {}}
            showMorphology
            sourceLanguageTag="el"
          />
        </PanelProviders>,
      );

      expect(list.scrollTop).toBe(0);
    });

    it('keeps the window where it is when the analysis changes under an unchanged query', () => {
      // A gloss approved in the view beside an open catalog rebuilds every row without narrowing
      // anything, and collapsing a deeply scrolled list back to its first chunk on that would throw
      // the reader to the end of it.
      renderPanelWithGlossEditing({ analysis: MANY });
      reachListEnd();
      const grown = screen.getAllByTestId('catalog-row').length;

      act(() => editGloss('GEN 1:1:0', 'word0', 'beginning'));

      expect(screen.getAllByTestId('catalog-row').length).toBe(grown);
    });
  });

  describe('row detail', () => {
    /** An analysis with a two-morpheme breakdown, used across the detail tests. */
    const ANALYZED: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'λόγος',
          gloss: { en: 'word' },
          morphemes: [
            {
              ...FIXTURE_STAMPS,
              id: 'm-1',
              form: 'λογ',
              gloss: { en: 'word' },
              writingSystem: 'el',
            },
            {
              ...FIXTURE_STAMPS,
              id: 'm-2',
              form: 'ος',
              gloss: { en: 'NOM.SG' },
              writingSystem: 'el',
            },
          ],
        },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
    };

    it('keeps the breakdown out of the list until the row is expanded', () => {
      renderPanel({ analysis: ANALYZED });

      expect(within(rowFor('ta-1')).queryByTestId('catalog-row-detail')).not.toBeInTheDocument();
    });

    it('reveals the morpheme breakdown when the row is expanded', async () => {
      renderPanel({ analysis: ANALYZED });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      // Each morpheme's gloss is an editable field, so it reads off the input rather than the text.
      const morphemes = within(rowFor('ta-1')).getAllByTestId('catalog-row-morpheme');
      expect(morphemes.map((m) => m.textContent)).toEqual(['λογ', 'ος']);
      expect(
        within(rowFor('ta-1'))
          .getAllByTestId('catalog-row-morpheme-gloss-input')
          .map((i) => i.getAttribute('value')),
      ).toEqual(['word', 'NOM.SG']);
    });

    it('shows a morpheme with no gloss in the active language as its form alone', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          {
            ...FIXTURE_STAMPS,
            id: 'ta-1',
            surfaceText: 'λόγος',
            // A breakdown is routinely entered before its glosses are, so a form without one is an
            // ordinary state rather than a broken record.
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' }],
          },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      expect(within(rowFor('ta-1')).getByTestId('catalog-row-morpheme')).toHaveTextContent('λογ');
    });

    it('reveals the usage locations when the row is expanded', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'EXO 3:14:8')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      expect(
        within(rowFor('ta-1'))
          .getAllByTestId('catalog-usage')
          .map((usage) => usage.textContent),
      ).toEqual(['GEN 1:1', 'EXO 3:14']);
    });

    it('says so when nothing uses the analysis', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      expect(within(rowFor('ta-1')).queryAllByTestId('catalog-usage')).toHaveLength(0);
      expect(within(rowFor('ta-1')).getByTestId('catalog-row-detail')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_noUsages%',
      );
    });

    describe('with more usages than fit inline', () => {
      /** One analysis used more times than the row lists inline. */
      const MANY_USAGES: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: Array.from({ length: 20 }, (_unused, index) =>
          link('ta-1', `GEN 1:${index + 1}:0`),
        ),
      };

      it('caps the inline list', async () => {
        renderPanel({ analysis: MANY_USAGES });

        await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

        expect(within(rowFor('ta-1')).getAllByTestId('catalog-usage')).toHaveLength(12);
      });

      it('reveals the rest from the expander', async () => {
        renderPanel({ analysis: MANY_USAGES });
        await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

        await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-usages-show-all'));

        expect(within(rowFor('ta-1')).getAllByTestId('catalog-usage')).toHaveLength(20);
        expect(
          within(rowFor('ta-1')).queryByTestId('catalog-usages-show-all'),
        ).not.toBeInTheDocument();
      });

      it('returns to the inline cap once the row is collapsed', async () => {
        renderPanel({ analysis: MANY_USAGES });
        const toggle = within(rowFor('ta-1')).getByTestId('catalog-row-toggle');
        await userEvent.click(toggle);
        await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-usages-show-all'));

        await userEvent.click(toggle);
        await userEvent.click(toggle);

        // A row left showing everything buries the rows below it for the rest of the session.
        expect(within(rowFor('ta-1')).getAllByTestId('catalog-usage')).toHaveLength(12);
      });
    });
  });

  describe('jumping to a usage', () => {
    /** One analysis used once in the book on screen and once in a book that is not. */
    const TWO_BOOKS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'EXO 3:14:8')],
    };

    /** Expands the row and clicks the usage naming `tokenRef`. */
    async function clickUsage(tokenRef: string): Promise<void> {
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      const usage = within(rowFor('ta-1'))
        .getAllByTestId('catalog-usage')
        .find((candidate) => candidate.dataset.tokenRef === tokenRef);
      if (!usage) throw new Error(`no usage for "${tokenRef}"`);
      await userEvent.click(usage);
    }

    it('navigates to the verse the usage names', async () => {
      const setScrRef = jest.fn();
      renderPanel({ analysis: TWO_BOOKS, setScrRef });

      await clickUsage('GEN 1:1:0');

      expect(setScrRef).toHaveBeenCalledWith(
        expect.objectContaining({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
    });

    it('asks for the clicked token to be focused, not merely its verse', async () => {
      renderPanel({ analysis: TWO_BOOKS });

      await clickUsage('GEN 1:1:0');

      // The ref carries the character offset, so a verse holding the same form twice still focuses
      // the occurrence that was clicked.
      expect(claimedFocusRequest).toBe('GEN 1:1:0');
    });

    it('navigates to another book when the usage is outside the one on screen', async () => {
      const setScrRef = jest.fn();
      renderPanel({ analysis: TWO_BOOKS, setScrRef });

      await clickUsage('EXO 3:14:8');

      expect(setScrRef).toHaveBeenCalledWith(
        expect.objectContaining({ book: 'EXO', chapterNum: 3, verseNum: 14 }),
      );
    });

    it('holds the focus request for another book until that book is on screen', async () => {
      const { rerender } = renderPanel({ analysis: TWO_BOOKS, mountedBook: 'GEN' });

      await clickUsage('EXO 3:14:8');

      // The view showing GEN must not claim a request naming EXO: the book it names has not
      // mounted yet, and claiming would drop the request before it could be honored.
      expect(claimedFocusRequest).toBeUndefined();

      // The host echoes the jump's reference, then EXO's USJ arrives and its view mounts. The panel
      // itself is left out to stand for the moment before it has re-rendered against the new book.
      rerender(
        <PanelProviders
          overrides={{
            analysis: TWO_BOOKS,
            mountedBook: 'EXO',
            scrRef: { book: 'EXO', chapterNum: 3, verseNum: 14 },
          }}
        >
          {undefined}
        </PanelProviders>,
      );

      expect(claimedFocusRequest).toBe('EXO 3:14:8');
    });

    it('abandons the focus request when the reader navigates past the book it names', async () => {
      const { rerender } = renderPanel({ analysis: TWO_BOOKS, mountedBook: 'GEN' });

      await clickUsage('EXO 3:14:8');

      // EXO's load never arrives; the reader navigates somewhere else entirely in the meantime.
      // The probe stands in for a view of that third book, which claims nothing here. The request
      // is held in a ref inside the navigation provider, so these steps rerender through the same
      // root the mount used: a remounted provider holds no request, and the assertion below would
      // hold however the pending one had been treated.
      rerender(
        <PanelProviders
          overrides={{
            analysis: TWO_BOOKS,
            mountedBook: 'LEV',
            scrRef: { book: 'LEV', chapterNum: 1, verseNum: 1 },
          }}
        >
          {undefined}
        </PanelProviders>,
      );

      // EXO finally mounts, long after the reader moved on.
      rerender(
        <PanelProviders
          overrides={{
            analysis: TWO_BOOKS,
            mountedBook: 'EXO',
            scrRef: { book: 'EXO', chapterNum: 3, verseNum: 14 },
          }}
        >
          {undefined}
        </PanelProviders>,
      );

      // Honoring it now would yank focus on a visit the reader made for their own reasons, long
      // after the click that asked for it.
      expect(claimedFocusRequest).toBeUndefined();
    });

    it('leaves the panel open and the clicked row selected', async () => {
      renderPanel({ analysis: TWO_BOOKS });

      await clickUsage('EXO 3:14:8');

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
      expect(rowFor('ta-1')).toHaveAttribute('data-selected', 'true');
    });

    it('keeps the jumped-from row selected through a search that still matches it', async () => {
      renderPanel({ analysis: TWO_BOOKS });
      await clickUsage('GEN 1:1:0');

      await userEvent.type(searchBox(), 'λογ');

      // The mark is what tells a reader where the view they are looking at came from, so narrowing
      // the list around that very row must not be what erases it.
      expect(rowFor('ta-1')).toHaveAttribute('data-selected', 'true');
    });

    it('leaves an untouched row unselected', async () => {
      const analysis: TextAnalysis = {
        ...TWO_BOOKS,
        tokenAnalyses: [
          ...TWO_BOOKS.tokenAnalyses,
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ' },
        ],
      };
      renderPanel({ analysis });

      await clickUsage('GEN 1:1:0');

      expect(rowFor('ta-2')).toHaveAttribute('data-selected', 'false');
    });
  });

  it('dismisses the panel from the close control', async () => {
    const onClose = jest.fn();
    renderPanel({ onClose });

    await userEvent.click(screen.getByTestId('analysis-catalog-close'));

    expect(onClose).toHaveBeenCalled();
  });

  describe('editing a row', () => {
    /** One analysis, shared by two tokens, so an edit here is visibly an edit to both. */
    const SHARED: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'GEN 1:3:4')],
    };

    /** Expands the row and returns its detail, where the edit controls live. */
    async function expandRow(analysisId: string): Promise<HTMLElement> {
      await userEvent.click(within(rowFor(analysisId)).getByTestId('catalog-row-toggle'));
      return rowFor(analysisId);
    }

    it('rewrites the gloss for every token linked to the analysis', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      const input = within(row).getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'message');
      await userEvent.tab();

      // One payload holding both links, so the single write reached both tokens without forking.
      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses).toHaveLength(1);
      expect(saved.tokenAnalyses[0].gloss).toEqual({ en: 'message' });
      expect(saved.tokenAnalysisLinks.map((l) => l.analysisId)).toEqual(['ta-1', 'ta-1']);
    });

    it('rewrites the morpheme breakdown for every token linked to the analysis', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      const input = within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'λογ ος');
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-save'));

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses).toHaveLength(1);
      expect(saved.tokenAnalyses[0].morphemes?.map((m) => m.form)).toEqual(['λογ', 'ος']);
      expect(saved.tokenAnalysisLinks.map((l) => l.analysisId)).toEqual(['ta-1', 'ta-1']);
    });

    it('leaves the breakdown alone when the editor is canceled', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      await userEvent.type(
        within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input'),
        'λογ ος',
      );
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-cancel'));

      expect(onSave).not.toHaveBeenCalled();
    });

    it('commits a gloss edit on Enter', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      const input = within(row).getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'message{Enter}');

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses[0].gloss).toEqual({ en: 'message' });
    });

    it('reverts a gloss edit on Escape', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      const input = within(row).getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'message{Escape}');

      // Reverted to the committed text, so the blur that follows has nothing left to write.
      expect(input).toHaveAttribute('value', 'word');
      await userEvent.tab();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('commits a breakdown edit on Enter', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      const input = within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'λογ ος{Enter}');

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses[0].morphemes?.map((m) => m.form)).toEqual(['λογ', 'ος']);
    });

    it('abandons a breakdown edit on Escape', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: SHARED, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      await userEvent.type(
        within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input'),
        'λογ ος{Escape}',
      );

      expect(onSave).not.toHaveBeenCalled();
      expect(
        within(rowFor('ta-1')).queryByTestId('catalog-row-breakdown-input'),
      ).not.toBeInTheDocument();
    });

    it('removes the breakdown when the editor is emptied', async () => {
      const analysis: TextAnalysis = {
        ...SHARED,
        tokenAnalyses: [
          {
            ...SHARED.tokenAnalyses[0],
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' }],
          },
        ],
      };
      const onSave = jest.fn();
      renderPanel({ analysis, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      await userEvent.clear(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input'));
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-save'));

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses[0].morphemes).toBeUndefined();
    });

    it('removes the breakdown when the editor is given the whole word back', async () => {
      const analysis: TextAnalysis = {
        ...SHARED,
        tokenAnalyses: [
          {
            ...SHARED.tokenAnalyses[0],
            morphemes: [
              { ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' },
              { ...FIXTURE_STAMPS, id: 'm-2', form: 'ος', writingSystem: 'el' },
            ],
          },
        ],
      };
      const onSave = jest.fn();
      renderPanel({ analysis, onSave });

      const row = await expandRow('ta-1');
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      const input = within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input');
      await userEvent.clear(input);
      // A lone morpheme equal to the whole word records no segmentation, so asking for it is a
      // request for the unsegmented state rather than a one-morpheme breakdown.
      await userEvent.type(input, 'λόγος');
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-save'));

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses[0].morphemes).toBeUndefined();
    });

    it('rewrites a morpheme gloss for every token linked to the analysis', async () => {
      const analysis: TextAnalysis = {
        ...SHARED,
        tokenAnalyses: [
          {
            ...SHARED.tokenAnalyses[0],
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' }],
          },
        ],
      };
      const onSave = jest.fn();
      renderPanel({ analysis, onSave });

      const row = await expandRow('ta-1');
      await userEvent.type(
        within(row).getByTestId('catalog-row-morpheme-gloss-input'),
        'word-stem',
      );
      await userEvent.tab();

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses[0].morphemes?.[0].gloss).toEqual({ en: 'word-stem' });
    });

    describe('reporting uncommitted text', () => {
      /** One analysis with a breakdown, so the breakdown editor opens onto committed forms. */
      const SEGMENTED: TextAnalysis = {
        ...SHARED,
        tokenAnalyses: [
          {
            ...SHARED.tokenAnalyses[0],
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'λογ', writingSystem: 'el' }],
          },
        ],
      };

      it('reports a gloss held uncommitted, so the unsaved indicator lights while typing', async () => {
        const onPendingEditsChange = jest.fn();
        renderPanel({ analysis: SHARED, onPendingEditsChange });

        const row = await expandRow('ta-1');
        await userEvent.type(within(row).getByTestId('catalog-row-gloss-input'), '!');

        expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);
      });

      it('stops reporting a gloss once it commits on blur', async () => {
        const onPendingEditsChange = jest.fn();
        renderPanel({ analysis: SHARED, onPendingEditsChange });

        const row = await expandRow('ta-1');
        await userEvent.type(within(row).getByTestId('catalog-row-gloss-input'), '!');
        await userEvent.tab();

        expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
      });

      it('reports a breakdown held uncommitted', async () => {
        const onPendingEditsChange = jest.fn();
        renderPanel({ analysis: SEGMENTED, onPendingEditsChange });

        const row = await expandRow('ta-1');
        await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
        await userEvent.type(
          within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input'),
          '-ος',
        );

        expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);
      });

      it('stops reporting a breakdown once it is canceled', async () => {
        const onPendingEditsChange = jest.fn();
        renderPanel({ analysis: SEGMENTED, onPendingEditsChange });

        const row = await expandRow('ta-1');
        await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
        await userEvent.type(
          within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-input'),
          '-ος',
        );
        await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-breakdown-cancel'));

        expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
      });

      // Opening the editor on an unsegmented word pre-fills the whole word, which commits as the
      // unsegmented state it already holds — nothing is at stake until the reader changes it.
      it('reports nothing for a breakdown draft that would commit as a no-op', async () => {
        const onPendingEditsChange = jest.fn();
        renderPanel({ analysis: SHARED, onPendingEditsChange });

        const row = await expandRow('ta-1');
        await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));

        expect(onPendingEditsChange).not.toHaveBeenCalled();
      });
    });
  });

  describe('merging on edit', () => {
    /** Two homographs whose glosses differ, so editing one into the other's collapses them. */
    const TWO_HOMOGRAPHS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-2', 'GEN 1:3:4'),
        link('ta-2', 'GEN 2:7:2'),
      ],
    };

    /** Edits `ta-1`'s gloss to match `ta-2`'s, which collapses the two onto `ta-2`. */
    async function editIntoEquality(): Promise<void> {
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      const input = within(rowFor('ta-1')).getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'beginning');
      await userEvent.tab();
    }

    it('drops the edited row and moves its usages onto the surviving one', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });

      await editIntoEquality();

      expect(listedAnalysisIds()).toEqual(['ta-2']);
      expect(within(rowFor('ta-2')).getByTestId('catalog-row-usage-count')).toHaveTextContent('3');
    });

    it('announces where the edited row went', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });

      await editIntoEquality();

      // The notice names the surviving gloss and its new count, so a row vanishing while another's
      // count jumps reads as the convergence it is rather than as lost work.
      expect(screen.getByTestId('catalog-merge-notice')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_merged%',
      );
    });

    it('names the survivor by its form when it carries no gloss', async () => {
      const morphemes = [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el' }];
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          // A breakdown apiece, so clearing ta-1's gloss leaves a record with content rather than
          // an empty one — and one identical to ta-2, which collapses the two onto a survivor
          // there is no gloss to name.
          {
            ...FIXTURE_STAMPS,
            id: 'ta-1',
            surfaceText: 'ἀρχῇ',
            gloss: { en: 'start' },
            morphemes,
          },
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', morphemes },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:3:4')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      await userEvent.clear(within(rowFor('ta-1')).getByTestId('catalog-row-gloss-input'));
      await userEvent.tab();

      expect(screen.getByTestId('catalog-merge-notice')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_mergedNoGloss%',
      );
    });

    it('leaves no notice when an edit empties the record away', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        // Gloss and nothing else, so clearing it leaves an empty record, which is removed outright
        // rather than collapsed onto anything — there is no survivor to send the reader to.
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      await userEvent.clear(within(rowFor('ta-1')).getByTestId('catalog-row-gloss-input'));
      await userEvent.tab();

      expect(screen.queryByTestId('catalog-merge-notice')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('catalog-row')).toHaveLength(0);
    });

    it('leaves no notice when the emptied record’s token keeps an unrelated candidate', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        // A token may carry several links at once, only the approved one being unique. Clearing the
        // approved record's gloss empties it away, leaving the candidate behind untouched — which
        // is not a collapse onto it, however much the surviving link looks like one.
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'λόγος', gloss: { en: 'reason' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:1:0', 'candidate')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      await userEvent.clear(within(rowFor('ta-1')).getByTestId('catalog-row-gloss-input'));
      await userEvent.tab();

      expect(screen.queryByTestId('catalog-merge-notice')).not.toBeInTheDocument();
    });

    it('leaves no notice when an edit collapses nothing', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));
      const input = within(rowFor('ta-1')).getByTestId('catalog-row-gloss-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'origin');
      await userEvent.tab();

      expect(screen.queryByTestId('catalog-merge-notice')).not.toBeInTheDocument();
    });

    it('dismisses the notice from its own control', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });
      await editIntoEquality();

      await userEvent.click(screen.getByTestId('catalog-merge-notice-dismiss'));

      expect(screen.queryByTestId('catalog-merge-notice')).not.toBeInTheDocument();
    });
  });

  describe('merging into another row', () => {
    const TWO_HOMOGRAPHS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:3:4')],
    };

    it('offers the merge control to a row with pool peers', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      expect(within(rowFor('ta-1')).getByTestId('catalog-row-merge')).toBeInTheDocument();
    });

    it('withholds the merge control from a row with no pool peers', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      expect(within(rowFor('ta-1')).queryByTestId('catalog-row-merge')).not.toBeInTheDocument();
    });

    it('moves every usage onto the chosen target', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-merge'));
      await userEvent.click(screen.getByTestId('catalog-merge-peer'));
      await userEvent.click(screen.getByTestId('catalog-merge-confirm'));

      expect(listedAnalysisIds()).toEqual(['ta-2']);
      expect(within(rowFor('ta-2')).getByTestId('catalog-row-usage-count')).toHaveTextContent('2');
    });

    it('leaves both analyses alone when the picker is canceled', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-merge'));
      await userEvent.click(screen.getByTestId('catalog-merge-cancel'));

      // Both still listed; the order is the default most-used-first, which the two tie on.
      expect(listedAnalysisIds()).toHaveLength(2);
      expect(listedAnalysisIds()).toContain('ta-1');
      expect(listedAnalysisIds()).toContain('ta-2');
    });

    it('labels a peer that carries no gloss rather than leaving it nameless', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
          {
            ...FIXTURE_STAMPS,
            id: 'ta-2',
            surfaceText: 'ἀρχῇ',
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el' }],
          },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:3:4')],
      };
      renderPanel({ analysis });
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-merge'));

      // The stub leaves every key unresolved, which stands in for the lookup not having landed —
      // so the peer falls back to the em dash rather than being offered as a blank choice.
      expect(screen.getByTestId('catalog-merge-peer')).toHaveTextContent('—');
    });

    it('refuses to merge until a target is chosen', async () => {
      renderPanel({ analysis: TWO_HOMOGRAPHS });
      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-toggle'));

      await userEvent.click(within(rowFor('ta-1')).getByTestId('catalog-row-merge'));

      expect(screen.getByTestId('catalog-merge-confirm')).toBeDisabled();
    });
  });

  describe('deleting a row', () => {
    /** One analysis nothing else shares a form with, so deleting it leaves its token blank. */
    const LONE: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'GEN 1:3:4')],
    };

    /** Expands the row and opens its delete confirmation. */
    async function openDeleteConfirm(analysisId: string): Promise<void> {
      await userEvent.click(within(rowFor(analysisId)).getByTestId('catalog-row-toggle'));
      await userEvent.click(within(rowFor(analysisId)).getByTestId('catalog-row-delete'));
    }

    it('states that the uses are left blank when no homograph survives', async () => {
      renderPanel({ analysis: LONE });

      await openDeleteConfirm('ta-1');

      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteBlank%',
      );
    });

    it('states the fallback the uses take when a homograph survives', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
        ],
        tokenAnalysisLinks: [
          link('ta-1', 'GEN 1:1:0'),
          link('ta-1', 'GEN 1:3:4'),
          link('ta-2', 'GEN 2:7:2'),
        ],
      };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      // The two outcomes must be told apart: this copy is the only guard before an irreversible
      // delete, and promising a fallback that does not exist is worse than no confirmation at all.
      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteFallback%',
      );
    });

    it('states a lone blanked use in the singular', async () => {
      const analysis: TextAnalysis = {
        ...LONE,
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
      };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      // "1 uses will be left with no analysis" reads as a bug in the sentence that has to carry an
      // irreversible decision, so the singular is a message of its own.
      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteBlankOne%',
      );
    });

    it('states that nothing else changes when the analysis is used nowhere', async () => {
      const analysis: TextAnalysis = { ...LONE, tokenAnalysisLinks: [] };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteBlankNone%',
      );
    });

    it('states a lone falling-back use in the singular', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
          { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 2:7:2')],
      };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteFallbackOne%',
      );
    });

    it('describes a fallback that carries no gloss rather than naming it', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
          // A breakdown but no gloss: analyzed enough to win the fallback, with no word to quote.
          {
            ...FIXTURE_STAMPS,
            id: 'ta-2',
            surfaceText: 'ἀρχῇ',
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el' }],
          },
        ],
        tokenAnalysisLinks: [
          link('ta-1', 'GEN 1:1:0'),
          link('ta-1', 'GEN 1:3:4'),
          link('ta-2', 'GEN 2:7:2'),
        ],
      };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteFallbackNoGloss%',
      );
    });

    it('describes a lone use falling back to a glossless analysis in the singular', async () => {
      const analysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'start' } },
          {
            ...FIXTURE_STAMPS,
            id: 'ta-2',
            surfaceText: 'ἀρχῇ',
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el' }],
          },
        ],
        tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 2:7:2')],
      };
      renderPanel({ analysis });

      await openDeleteConfirm('ta-1');

      expect(screen.getByTestId('catalog-delete-outcome')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_deleteFallbackNoGlossOne%',
      );
    });

    it('removes the analysis and its links when confirmed', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: LONE, onSave });
      await openDeleteConfirm('ta-1');

      await userEvent.click(screen.getByTestId('catalog-delete-confirm'));

      const saved: TextAnalysis = onSave.mock.calls.at(-1)[0];
      expect(saved.tokenAnalyses).toEqual([]);
      expect(saved.tokenAnalysisLinks).toEqual([]);
    });

    it('leaves the analysis untouched when the confirmation is canceled', async () => {
      const onSave = jest.fn();
      renderPanel({ analysis: LONE, onSave });
      await openDeleteConfirm('ta-1');

      await userEvent.click(screen.getByTestId('catalog-delete-cancel'));

      expect(onSave).not.toHaveBeenCalled();
      expect(listedAnalysisIds()).toEqual(['ta-1']);
    });
  });
});
