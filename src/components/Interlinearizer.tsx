import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, TextAnalysis } from 'interlinearizer';
import { LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AnalysisStoreProvider } from './AnalysisStore';
import ContinuousView from './ContinuousView';
import EditPhraseControls from './EditPhraseControls';
import type { PhraseMode } from '../types/phrase-mode';
import { isWordToken } from '../types/typeGuards';
import MemoizedSegmentView from './SegmentView';
import UnlinkPhraseConfirm from './UnlinkPhraseConfirm';

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** Segments belonging to the current chapter, filtered by the caller. */
  chapterSegments: Segment[];
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /** Current scripture reference used to highlight the active verse. */
  scrRef: SerializedVerseRef;
  /** Called when the user navigates to a different verse. */
  setScrRef: (newScrRef: SerializedVerseRef) => void;
  /**
   * BCP 47 tag for reading and writing gloss values. Defaults to `analysisLanguages[0]` of the
   * active project (supplied by the caller).
   */
  analysisLanguage: string;
  /** Initial analysis data seeded into the store; not reactive after mount. */
  initialAnalysis?: TextAnalysis;
  /** Called after each gloss write with the updated `TextAnalysis` so the caller can persist it. */
  onSaveAnalysis?: (analysis: TextAnalysis) => void;
  /** Current phrase-interaction mode; owned by the parent and passed down for rendering. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed down so child components can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
}>;

/**
 * Inner component that renders the segment list and continuous view. Separated from
 * {@link Interlinearizer} so it can consume the `AnalysisStoreProvider` context that wraps it.
 *
 * @param props - Component props
 * @param props.book - Tokenized book whose segments are rendered.
 * @param props.chapterSegments - Segments belonging to the current chapter, filtered by the caller.
 * @param props.continuousScroll - When true, the horizontal token strip is shown above the segment
 *   list.
 * @param props.scrRef - Current scripture reference used to highlight the active verse.
 * @param props.setScrRef - Called when the user navigates to a different verse.
 * @returns The interlinearizer layout without the provider wrapper.
 */
function InterlinearizerInner({
  book,
  chapterSegments,
  continuousScroll,
  scrRef,
  setScrRef,
  phraseMode,
  setPhraseMode,
}: Omit<InterlinearizerProps, 'initialAnalysis' | 'analysisLanguage' | 'onSaveAnalysis'>) {
  // Seed focusedTokenRef from the active verse on first render so the views always see a defined
  // value. An undefined focusedTokenRef would disable all link buttons (isSameSegmentAsFocus checks
  // focus.focusedSegmentId), so we never want it unset while there's a valid seed available.
  const [focusedTokenRef, setFocusedTokenRef] = useState<string | undefined>(() => {
    const activeSeg = chapterSegments.find((seg) => seg.startRef.verse === scrRef.verseNum);
    return activeSeg?.tokens.find((t) => t.type === 'word')?.ref;
  });

  // Reseed when the book changes — the previous focusedTokenRef refers to a token from another
  // book and would never resolve in the new book's maps.
  useEffect(() => {
    const activeSeg = chapterSegments.find((seg) => seg.startRef.verse === scrRef.verseNum);
    setFocusedTokenRef(activeSeg?.tokens.find((t) => t.type === 'word')?.ref);
    // chapterSegments and scrRef change frequently; only re-seed on book change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  /** All word tokens in book order — index into this array is the phrase index. */
  const wordTokens = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens).filter(isWordToken),
    [book.segments],
  );

  /** Maps every token ref to the id of the segment that contains it. */
  const tokenSegmentMap = useMemo(() => {
    const map = new Map<string, string>();
    book.segments.forEach((seg) => {
      seg.tokens.forEach((t) => map.set(t.ref, seg.id));
    });
    return map;
  }, [book.segments]);

  /** Maps every word token ref to the token; used by views to resolve focus context. */
  const wordTokenByRef = useMemo(() => {
    const map = new Map<string, (typeof wordTokens)[number]>();
    wordTokens.forEach((t) => map.set(t.ref, t));
    return map;
  }, [wordTokens]);

  const scrollContainerRef = useRef<HTMLDivElement | undefined>(undefined);

  /**
   * Ref callback that stores the scroll container element so imperative scroll calls can target it.
   *
   * @param el - The mounted div, or `null` on unmount.
   */
  const setScrollContainer = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el ?? undefined;
  }, []);

  /**
   * Scrolls the element marked `aria-current="true"` inside the scroll container into view at the
   * top of the list.
   */
  const snapToActive = useCallback(() => {
    const container = scrollContainerRef.current;
    const active = container?.querySelector('[aria-current="true"]');
    /* v8 ignore next -- active is always found when a verse is rendered; guard for empty lists */
    active?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);

  /** PhraseId currently hovered anywhere in the interlinearizer; shared across all SegmentViews. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  /** The segment id that contains the phrase currently being edited, if any. */
  const editPhraseSegmentId = useMemo(() => {
    if (phraseMode.kind !== 'edit') return undefined;
    const firstTokenRef = phraseMode.originalTokens[0]?.tokenRef;
    /* v8 ignore next -- a phrase always has at least one token at edit-entry time */
    if (firstTokenRef === undefined) return undefined;
    return tokenSegmentMap.get(firstTokenRef);
  }, [phraseMode, tokenSegmentMap]);

  // Snap the segment list to the active verse when switching modes.
  useEffect(() => {
    snapToActive();
    // snapToActive is stable (useCallback with no changing deps), so this only re-runs on mode switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  /**
   * Updates the active scripture reference and, when a specific token was clicked, focuses that
   * token.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenRef - The token that was clicked; omitted when the whole segment was selected.
   */
  const handleSegmentSelect = useCallback(
    (ref: ScriptureRef, tokenRef?: string) => {
      setScrRef({ book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse });
      if (tokenRef) setFocusedTokenRef(tokenRef);
    },
    [setScrRef],
  );

  /**
   * Updates the active scripture reference when ContinuousView reports a verse change via arrow
   * navigation. A separate wrapper from `handleSegmentSelect` because verse changes from the strip
   * never carry a token id.
   *
   * @param ref - The new verse coordinate reported by the strip.
   */
  const handleVerseChange = useCallback(
    (ref: ScriptureRef) => {
      handleSegmentSelect(ref);
    },
    [handleSegmentSelect],
  );

  return (
    <div className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
      {continuousScroll && (
        <div className="tw:shrink-0 tw:border-b tw:border-border tw:bg-background tw:py-2">
          <ContinuousView
            activeVerse={{
              book: scrRef.book,
              chapter: scrRef.chapterNum,
              verse: scrRef.verseNum,
            }}
            book={book}
            focusedTokenRef={focusedTokenRef}
            onFocusedTokenRefChange={setFocusedTokenRef}
            onVerseChange={handleVerseChange}
            phraseMode={phraseMode}
            setPhraseMode={setPhraseMode}
            tokenSegmentMap={tokenSegmentMap}
            wordTokenByRef={wordTokenByRef}
          />
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
      >
        {(phraseMode.kind === 'confirm-unlink' || phraseMode.kind === 'edit') && (
          <div className="tw:sticky tw:top-0 tw:z-20 tw:h-0 tw:flex tw:justify-end tw:pointer-events-none">
            <div className="tw:pointer-events-auto tw:translate-y-2">
              {phraseMode.kind === 'confirm-unlink' ? (
                <UnlinkPhraseConfirm phraseId={phraseMode.phraseId} setPhraseMode={setPhraseMode} />
              ) : (
                <EditPhraseControls phraseMode={phraseMode} setPhraseMode={setPhraseMode} />
              )}
            </div>
          </div>
        )}
        {chapterSegments.length === 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            No verse data for {scrRef.book} {scrRef.chapterNum}.
          </p>
        )}

        {chapterSegments.length > 0 && (
          <>
            <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:justify-end tw:pointer-events-none">
              <button
                aria-label="Scroll to active verse"
                className="tw:rounded tw:p-1 tw:text-foreground tw:hover:bg-muted/50 tw:pointer-events-auto"
                onClick={snapToActive}
                type="button"
              >
                <LocateFixed className="tw:h-4 tw:w-4" />
              </button>
            </div>

            <div className="tw:flex tw:flex-col tw:gap-2">
              {chapterSegments.map((seg) => (
                <MemoizedSegmentView
                  key={seg.id}
                  displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                  editPhraseSegmentId={editPhraseSegmentId}
                  focusedTokenRef={continuousScroll ? undefined : focusedTokenRef}
                  hoveredPhraseId={hoveredPhraseId}
                  isActive={seg.startRef.verse === scrRef.verseNum}
                  onHoverPhrase={setHoveredPhraseId}
                  onSelect={handleSegmentSelect}
                  phraseMode={phraseMode}
                  setPhraseMode={setPhraseMode}
                  segment={seg}
                  tokenSegmentMap={tokenSegmentMap}
                  wordTokenByRef={wordTokenByRef}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Main component for the Interlinearizer. Renders a sticky toolbar and continuous view at the top,
 * followed by segmented views. Wraps the layout in an {@link AnalysisStoreProvider} so all
 * descendant components can read and write analysis data without prop drilling.
 *
 * @param props - Component props
 * @param props.book - Book data used by the continuous view
 * @param props.chapterSegments - Segments to render as individual verse views
 * @param props.continuousScroll - Whether the continuous scroll view is shown
 * @param props.scrRef - Current scripture reference
 * @param props.setScrRef - Callback to update the scripture reference
 * @param props.initialAnalysis - Seed analysis data for the store; not reactive after mount
 * @param props.analysisLanguage - BCP 47 tag for gloss read/write
 * @param props.onSaveAnalysis - Called after each gloss write with the updated `TextAnalysis`
 * @param props.phraseMode - Current phrase-interaction mode owned by the parent
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @returns The full interlinearizer layout with optional continuous strip and segment list
 */
export default function Interlinearizer({
  initialAnalysis,
  analysisLanguage,
  onSaveAnalysis,
  ...innerProps
}: InterlinearizerProps) {
  return (
    <AnalysisStoreProvider
      initialAnalysis={initialAnalysis}
      analysisLanguage={analysisLanguage}
      onSave={onSaveAnalysis}
    >
      <InterlinearizerInner {...innerProps} />
    </AnalysisStoreProvider>
  );
}
