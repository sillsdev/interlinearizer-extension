/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { useEffect } from 'react';
import AnalysisCatalogPanel from '../../components/AnalysisCatalogPanel';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import { emptyAnalysis } from '../../types/empty-factories';
import { defaultScrRef, FIXTURE_STAMPS, makeScrollGroupHook } from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

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
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  currentBook: string;
  analysis: TextAnalysis;
  analysisLanguage: string;
  /** Records every reference the panel navigates to, through the host scroll-group hook. */
  setScrRef: (ref: SerializedVerseRef) => void;
  /** Book the focus probe stands in for, i.e. the one the view has mounted. */
  mountedBook: string;
}>;

/** Renders the panel inside a seeded analysis store and a real navigation provider. */
function renderPanel(overrides: PanelOptions = {}) {
  return render(
    <InterlinearNavProvider
      useWebViewScrollGroupScrRef={makeScrollGroupHook(defaultScrRef, overrides.setScrRef)}
    >
      <AnalysisStoreProvider
        analysisLanguage={overrides.analysisLanguage ?? 'en'}
        initialAnalysis={overrides.analysis ?? emptyAnalysis()}
      >
        <FocusRequestProbe bookCode={overrides.mountedBook ?? 'GEN'} />
        <AnalysisCatalogPanel
          currentBook={overrides.currentBook ?? 'GEN'}
          onClose={overrides.onClose ?? (() => {})}
          onWidthChange={overrides.onWidthChange ?? (() => {})}
          sourceLanguageTag="el"
          width={overrides.width ?? 320}
        />
      </AnalysisStoreProvider>
    </InterlinearNavProvider>,
  );
}

/** Reads the catalog row for `analysisId`, failing the test when the list has no such row. */
function rowFor(analysisId: string): HTMLElement {
  const row = screen
    .getAllByTestId('catalog-row')
    .find((candidate) => candidate.dataset.analysisId === analysisId);
  if (!row) throw new Error(`no catalog row for "${analysisId}"`);
  return row;
}

/**
 * Drags the resize handle from `fromClientX` to `toClientX`. The handle listens on the window for
 * the move and release, so those are dispatched there rather than on the handle itself — a real
 * drag routinely leaves the handle's own box between frames.
 *
 * The move carries the button it holds — a real one does, jsdom does not unless told — because the
 * panel reads that to tell a live drag from a release it never saw.
 */
function dragHandle(fromClientX: number, toClientX: number): void {
  fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), { clientX: fromClientX });
  fireEvent.mouseMove(window, { clientX: toClientX, buttons: 1 });
  fireEvent.mouseUp(window, { clientX: toClientX });
}

describe('AnalysisCatalogPanel', () => {
  beforeEach(() => {
    claimedFocusRequest = undefined;
    mockKeyAsValueLocalizedStrings();
  });

  describe('resizing', () => {
    it('widens the panel when the handle is dragged toward the start edge', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      // The panel is anchored to the end edge, so the handle moving toward the start edge widens it
      // by the distance traveled.
      dragHandle(500, 460);

      expect(onWidthChange).toHaveBeenCalledWith(360);
    });

    it('narrows the panel when the handle is dragged toward the end edge', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      dragHandle(500, 540);

      expect(onWidthChange).toHaveBeenCalledWith(280);
    });

    it('does not commit a width until the drag is released', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 460, buttons: 1 });

      // The width is persisted, so a write per frame would put the whole gesture through the host.
      expect(onWidthChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('analysis-catalog-panel')).toHaveStyle({ width: '360px' });
    });

    it('stops narrowing at the minimum width', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      dragHandle(500, 5000);

      expect(onWidthChange).toHaveBeenCalledWith(220);
    });

    it('stops widening at the maximum width', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      dragHandle(500, -5000);

      expect(onWidthChange).toHaveBeenCalledWith(800);
    });

    it('widens the panel by one step on ArrowLeft', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowLeft' });

      expect(onWidthChange).toHaveBeenCalledWith(336);
    });

    it('narrows the panel by one step on ArrowRight', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

      expect(onWidthChange).toHaveBeenCalledWith(304);
    });

    it('leaves the width alone on a key that does not resize', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'Enter' });

      expect(onWidthChange).not.toHaveBeenCalled();
    });

    it('commits nothing when the handle is pressed without being moved', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), { clientX: 500 });
      fireEvent.mouseUp(window, { clientX: 500 });

      // The width is persisted, so a stray click on the handle would otherwise put an unchanged
      // width through the host.
      expect(onWidthChange).not.toHaveBeenCalled();
    });

    it('leaves the width alone when a button other than the primary one presses the handle', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), {
        button: 1,
        buttons: 4,
        clientX: 500,
      });
      // The middle button reports itself held on every move that follows, so a drag begun from one
      // would follow the pointer and persist wherever the release found it.
      fireEvent.mouseMove(window, { buttons: 4, clientX: 460 });
      fireEvent.mouseUp(window, { clientX: 460 });

      expect(onWidthChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('analysis-catalog-panel')).toHaveStyle({ width: '320px' });
    });

    it('ends the drag at the width it reached when a move reports no button held', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 460, buttons: 1 });
      // Stands in for a release the window never saw — one over a native menu, say.
      fireEvent.mouseMove(window, { clientX: 400, buttons: 0 });

      expect(onWidthChange).toHaveBeenCalledWith(360);
    });

    it('stops following the pointer once a release it never saw has ended the drag', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      fireEvent.mouseDown(screen.getByTestId('analysis-catalog-resize'), { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 460, buttons: 1 });
      fireEvent.mouseMove(window, { clientX: 400, buttons: 0 });
      fireEvent.mouseMove(window, { clientX: 200, buttons: 0 });
      fireEvent.mouseUp(window, { clientX: 200 });

      // Otherwise a pointer merely crossing the window keeps widening the panel, and the click that
      // ends up committing reports wherever it got to.
      expect(onWidthChange).toHaveBeenCalledTimes(1);
      expect(onWidthChange).toHaveBeenLastCalledWith(360);
    });

    it('leaves an arrow key alone while a drag is in flight', () => {
      const onWidthChange = jest.fn();
      renderPanel({ width: 320, onWidthChange });

      const handle = screen.getByTestId('analysis-catalog-resize');
      fireEvent.mouseDown(handle, { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 460, buttons: 1 });
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });

      // Stepping off the width the drag began at would report a width the panel is not showing,
      // which the release then overwrites.
      expect(onWidthChange).not.toHaveBeenCalled();

      fireEvent.mouseUp(window, { clientX: 460 });

      expect(onWidthChange).toHaveBeenCalledWith(360);
    });

    describe('in a right-to-left interface', () => {
      beforeEach(() => {
        document.documentElement.dir = 'rtl';
      });

      // Plain assignment to the document, which `restoreMocks` cannot undo.
      afterEach(() => {
        document.documentElement.dir = '';
      });

      it('widens the panel when the handle is dragged toward the start edge', () => {
        const onWidthChange = jest.fn();
        renderPanel({ width: 320, onWidthChange });

        // The end edge the panel is anchored to is the screen's left here, putting the handle on
        // its right, so the travel that widens it is the mirror of the left-to-right one.
        dragHandle(500, 540);

        expect(onWidthChange).toHaveBeenCalledWith(360);
      });

      it('narrows the panel when the handle is dragged toward the end edge', () => {
        const onWidthChange = jest.fn();
        renderPanel({ width: 320, onWidthChange });

        dragHandle(500, 460);

        expect(onWidthChange).toHaveBeenCalledWith(280);
      });

      it('widens the panel by one step on ArrowRight', () => {
        const onWidthChange = jest.fn();
        renderPanel({ width: 320, onWidthChange });

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

        expect(onWidthChange).toHaveBeenCalledWith(336);
      });

      it('narrows the panel by one step on ArrowLeft', () => {
        const onWidthChange = jest.fn();
        renderPanel({ width: 320, onWidthChange });

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowLeft' });

        expect(onWidthChange).toHaveBeenCalledWith(304);
      });
    });
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

      expect(within(rowFor('ta-1')).getByTestId('catalog-row-gloss')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_noGloss%',
      );
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

      const morphemes = within(rowFor('ta-1')).getAllByTestId('catalog-row-morpheme');
      expect(morphemes.map((m) => m.textContent)).toEqual(['λογword', 'οςNOM.SG']);
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

      // The host echoes the jump's reference, then EXO's USJ arrives and its view mounts.
      rerender(
        <InterlinearNavProvider
          useWebViewScrollGroupScrRef={makeScrollGroupHook({
            book: 'EXO',
            chapterNum: 3,
            verseNum: 14,
          })}
        >
          <AnalysisStoreProvider analysisLanguage="en" initialAnalysis={TWO_BOOKS}>
            <FocusRequestProbe bookCode="EXO" />
          </AnalysisStoreProvider>
        </InterlinearNavProvider>,
      );

      expect(claimedFocusRequest).toBe('EXO 3:14:8');
    });

    it('leaves the panel open and the clicked row selected', async () => {
      renderPanel({ analysis: TWO_BOOKS });

      await clickUsage('EXO 3:14:8');

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
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
});
