/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { logger } from '@papi/frontend';
import type { Book, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { useEffect, type ReactNode } from 'react';
import { useGlossDispatch } from '../../components/AnalysisStore';
import ConcordancePanel, { CONCORDANCE_PANEL_STRING_KEYS } from '../../components/ConcordancePanel';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import { emptyAnalysis } from '../../types/empty-factories';
import type { TextReadStatus } from '../../types/text-read-status';
import { indexBook } from '../../utils/concordance';
import type { FakeText } from '../cache/fake-host';
import { renderWithAnalysis, settle } from './analysis-provider';
import { defaultScrRef, FIXTURE_STAMPS, makeScrollGroupHook, makeVerseBook } from '../test-helpers';

// What the reading status shows is its own concern; these cover only when the panel shows it.
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

/** Genesis, the book the view has open. */
const GENESIS = makeVerseBook([{ sid: 'GEN 1:3', text: 'Let there be light' }]);

/** Exodus, where "light" occurs again. */
const EXODUS = makeVerseBook([{ sid: 'EXO 10:23', text: 'had light' }]);

/**
 * The source text as the host reads it whole: read, with `books` in its concordance, Genesis and
 * Exodus by default.
 */
function textOf({
  books = [GENESIS, EXODUS],
  status = { booksRead: 2, bookCount: 2, failedBookIds: [] },
}: Partial<{ books: Book[]; status: TextReadStatus }> = {}): FakeText {
  return {
    status: () => status,
    isFormInText: () => undefined,
    concordanceBooks: () => books.map(indexBook),
  };
}

/** A text the host is still reading. */
const UNREAD: FakeText = {
  status: () => ({ booksRead: 1, bookCount: 2, failedBookIds: [] }),
  isFormInText: () => undefined,
};

/** Builds an approved link from `tokenRef` to the analysis. */
function link(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    id: `${tokenRef}:${analysisId}`,
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: 'light' },
  };
}

/**
 * The panel's strings as their own keys, except a `{book}` template for the per-book count and any
 * `overrides`.
 */
function panelStrings(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(CONCORDANCE_PANEL_STRING_KEYS.map((k) => [k, k])),
    '%interlinearizer_concordance_occurrenceCountInBook%': 'in {book}',
    ...overrides,
  };
}

const PANEL_STRINGS = panelStrings();

type PanelOptions = Partial<{
  /** The source text the host reads, {@link textOf}'s default by default. */
  text: FakeText;
  analysis: TextAnalysis;
  currentBook: string;
  currentBookName: string;
  localizedStrings: Record<string, string>;
  onClose: () => void;
  onShowCatalog: () => void;
  setScrRef: (ref: SerializedVerseRef) => void;
  /** Rendered inside the providers beside the panel, e.g. a probe writing to the store. */
  beside: ReactNode;
}>;

/** The panel inside a real navigation provider, for {@link renderPanel} to seed an analysis under. */
function panelTree(options: PanelOptions = {}) {
  return (
    <InterlinearNavProvider
      useWebViewScrollGroupScrRef={makeScrollGroupHook(defaultScrRef, options.setScrRef)}
    >
      <>
        <FocusRequestProbe bookCode="EXO" />
        {options.beside}
        <ConcordancePanel
          currentBook={options.currentBook ?? 'GEN'}
          currentBookName={options.currentBookName ?? 'Genesis'}
          localizedStrings={options.localizedStrings ?? PANEL_STRINGS}
          onClose={options.onClose ?? (() => {})}
          onShowCatalog={options.onShowCatalog ?? (() => {})}
          sourceLanguageTag="en"
        />
      </>
    </InterlinearNavProvider>
  );
}

/**
 * Renders the panel over `options.analysis`, an empty analysis by default, once it has the host's
 * answers.
 */
async function renderPanel(options: PanelOptions = {}) {
  const rendered = await renderWithAnalysis(panelTree(options), {
    analysis: options.analysis ?? emptyAnalysis(),
    book: GENESIS,
    text: options.text ?? textOf(),
  });
  await rendered.settle();
  return rendered;
}

/** The row listing `form`. */
function rowFor(form: string): HTMLElement {
  const row = screen.getAllByTestId('concordance-row').find((r) => r.dataset.form === form);
  if (!row) throw new Error(`no row for "${form}"`);
  return row;
}

beforeEach(() => {
  claimedFocusRequest = undefined;
});

describe('ConcordancePanel', () => {
  it('shows how far reading the books has got while the index is built', async () => {
    await renderPanel({ text: UNREAD });

    expect(screen.getByTestId('text-reading-status')).toBeInTheDocument();
    expect(screen.queryByTestId('concordance-row')).not.toBeInTheDocument();
  });

  it('says so when the books could not be listed', async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    await renderPanel({
      text: {
        ...UNREAD,
        status: () => {
          throw new Error('offline');
        },
      },
    });

    expect(screen.getByTestId('text-reading-status')).toBeInTheDocument();
    expect(screen.queryByTestId('concordance-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('concordance-empty')).not.toBeInTheDocument();
  });

  it('says so when the text has no words', async () => {
    await renderPanel({ text: textOf({ books: [] }) });

    expect(screen.getByTestId('concordance-empty')).toHaveTextContent(
      '%interlinearizer_concordance_empty%',
    );
  });

  /** The panel's strings with templates for the reading summary. */
  const SUMMARY_STRINGS = panelStrings({
    '%interlinearizer_concordance_booksRead%': 'Read {count}',
    '%interlinearizer_concordance_unreadBooks%': 'Unread: {books}',
  });

  it('says how many books were read once every book is read', async () => {
    await renderPanel({ localizedStrings: SUMMARY_STRINGS });

    expect(screen.getByTestId('concordance-books-read')).toHaveTextContent('Read 2');
    expect(screen.queryByTestId('concordance-unread-books')).not.toBeInTheDocument();
  });

  it('leaves a book with no text out of the books read', async () => {
    await renderPanel({ text: textOf({ books: [GENESIS] }), localizedStrings: SUMMARY_STRINGS });

    expect(screen.getByTestId('concordance-books-read')).toHaveTextContent('Read 1');
  });

  it('shows no reading summary while the text is still being read', async () => {
    await renderPanel({ text: UNREAD });

    expect(screen.queryByTestId('concordance-read-summary')).not.toBeInTheDocument();
  });

  it('names the books that failed to read beside what was read', async () => {
    await renderPanel({
      text: textOf({
        books: [GENESIS],
        status: { booksRead: 3, bookCount: 3, failedBookIds: ['EXO', 'LEV'] },
      }),
      localizedStrings: SUMMARY_STRINGS,
    });

    expect(screen.getByTestId('concordance-books-read')).toHaveTextContent('Read 1');
    expect(screen.getByTestId('concordance-unread-books')).toHaveTextContent('Unread: EXO, LEV');
    expect(screen.getAllByTestId('concordance-row')).not.toHaveLength(0);
  });

  it('reads the failed books again from its retry control', async () => {
    const retry = jest.fn();
    await renderPanel({
      text: {
        ...textOf({
          books: [GENESIS],
          status: { booksRead: 2, bookCount: 2, failedBookIds: ['EXO'] },
        }),
        retry,
      },
    });

    await userEvent.click(screen.getByTestId('concordance-retry'));

    expect(retry).toHaveBeenCalled();
  });

  it('offers no retry once every book has been read', async () => {
    await renderPanel();

    expect(screen.queryByTestId('concordance-retry')).not.toBeInTheDocument();
  });

  it('says the text could not be read, not that it has no words, when every book failed', async () => {
    await renderPanel({
      text: textOf({ books: [], status: { booksRead: 1, bookCount: 1, failedBookIds: ['GEN'] } }),
    });

    expect(screen.getByTestId('text-reading-status')).toBeInTheDocument();
    expect(screen.queryByTestId('concordance-empty')).not.toBeInTheDocument();
  });

  it('lists every form of the text, most frequent first', async () => {
    await renderPanel();

    expect(screen.getAllByTestId('concordance-row').map((r) => r.dataset.form)).toEqual([
      'light',
      'be',
      'had',
      'let',
      'there',
    ]);
  });

  it('counts each form in the current book, naming the book', async () => {
    await renderPanel({ currentBook: 'EXO', currentBookName: 'Exodus' });

    const count = within(rowFor('let')).getByTestId('concordance-row-count-in-book');
    expect(count).toHaveTextContent('0');
    expect(count).toHaveTextContent('in Exodus');
  });

  it('reads a form as analyzed where its occurrences carry approved analyses', async () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'a1', surfaceText: 'light' }],
      tokenAnalysisLinks: [link('a1', 'GEN 1:3:13')],
    };
    await renderPanel({ analysis });

    expect(within(rowFor('light')).getByTestId('concordance-row-status')).toHaveAttribute(
      'data-status',
      'partlyAnalyzed',
    );
  });

  it('follows a gloss approved beside the panel', async () => {
    await renderPanel({ beside: <GlossEditProbe /> });

    act(() => editGloss('EXO 10:23:4', 'light', 'light'));
    await settle();

    expect(within(rowFor('light')).getByTestId('concordance-row-status')).toHaveAttribute(
      'data-status',
      'partlyAnalyzed',
    );
  });

  describe('jumping to an occurrence', () => {
    async function clickOccurrence(form: string, tokenRef: string): Promise<void> {
      await userEvent.click(within(rowFor(form)).getByTestId('concordance-row-toggle'));
      await settle();
      const occurrence = within(rowFor(form))
        .getAllByTestId('concordance-occurrence')
        .find((o) => o.dataset.tokenRef === tokenRef);
      if (!occurrence) throw new Error(`no occurrence "${tokenRef}"`);
      await userEvent.click(occurrence);
    }

    it('navigates to the verse the occurrence sits in', async () => {
      const setScrRef = jest.fn();
      await renderPanel({ setScrRef });

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(setScrRef).toHaveBeenCalledWith(
        expect.objectContaining({ book: 'EXO', chapterNum: 10, verseNum: 23 }),
      );
    });

    it('asks for the occurrence itself to be focused', async () => {
      await renderPanel();

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(claimedFocusRequest).toBe('EXO 10:23:4');
    });

    it('marks the row the jump came from', async () => {
      await renderPanel();

      await clickOccurrence('light', 'EXO 10:23:4');

      expect(rowFor('light')).toHaveAttribute('data-selected', 'true');
      expect(rowFor('had')).toHaveAttribute('data-selected', 'false');
    });
  });

  it('closes from its own close control', async () => {
    const onClose = jest.fn();
    await renderPanel({ onClose });

    await userEvent.click(screen.getByTestId('concordance-close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('switches to the analysis catalog from its tab', async () => {
    const onShowCatalog = jest.fn();
    await renderPanel({ onShowCatalog });

    await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

    expect(onShowCatalog).toHaveBeenCalled();
  });

  describe('with a long list', () => {
    const MANY = makeVerseBook([
      {
        sid: 'GEN 1:1',
        text: Array.from({ length: 100 }, (_unused, index) => `w${index}`).join(' '),
      },
    ]);

    it('mounts only part of it', async () => {
      await renderPanel({ text: textOf({ books: [MANY] }) });

      const mounted = screen.getAllByTestId('concordance-row').length;
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThan(100);
    });

    it('mounts more as the end of what is mounted comes into view', async () => {
      await renderPanel({ text: textOf({ books: [MANY] }) });
      const before = screen.getAllByTestId('concordance-row').length;

      act(() => {
        global.triggerIntersection(screen.getByTestId('concordance-rows-sentinel'), true);
      });
      await settle();

      expect(screen.getAllByTestId('concordance-row').length).toBeGreaterThan(before);
    });

    it('grows no further than a chunk past the rows that have arrived', async () => {
      await renderPanel({ text: textOf({ books: [MANY] }) });
      const before = screen.getAllByTestId('concordance-row').length;

      act(() => {
        global.triggerIntersection(screen.getByTestId('concordance-rows-sentinel'), true);
      });
      act(() => {
        global.triggerIntersection(screen.getByTestId('concordance-rows-sentinel'), true);
      });
      await settle();

      expect(screen.getAllByTestId('concordance-row')).toHaveLength(before * 2);
    });
  });
});
