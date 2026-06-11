import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, TextAnalysis } from 'interlinearizer';
import { LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AnalysisStoreProvider, usePhraseDispatch } from './AnalysisStore';
import ContinuousView from './ContinuousView';
import EditPhraseControls from './controls/EditPhraseControls';
import type { PhraseMode } from '../types/phrase-mode';
import { isWordToken } from '../types/type-guards';
import MemoizedSegmentView from './SegmentView';
import UnlinkPhraseConfirm from './modals/UnlinkPhraseConfirm';

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
  /** When true, link buttons between phrases are hidden in segments other than the active verse. */
  hideInactiveLinkButtons: boolean;
  /** When true, phrase-level controls are hidden on every phrase except the focused one. */
  simplifyPhrases: boolean;
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
 * @param props.phraseMode - Current phrase-interaction mode passed down for rendering.
 * @param props.setPhraseMode - Setter for `phraseMode`; passed to child components so they can
 *   transition modes.
 * @param props.hideInactiveLinkButtons - When true, link buttons between phrases are hidden in
 *   segments other than the active verse.
 * @param props.simplifyPhrases - When true, phrase-level controls are hidden on every phrase except
 *   the focused one.
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
  hideInactiveLinkButtons,
  simplifyPhrases,
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

  /** Maps every segment id to the segment; used to resolve a focused token's verse. */
  const segmentById = useMemo(() => {
    const map = new Map<string, Segment>();
    book.segments.forEach((seg) => map.set(seg.id, seg));
    return map;
  }, [book.segments]);

  /** All word tokens in book order — index into this array is the phrase index. */
  const wordTokens = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens).filter(isWordToken),
    [book.segments],
  );

  /**
   * Maps every word token ref to its flat book-level index; used to sort phrase tokens in document
   * order.
   */
  const tokenDocOrder = useMemo(() => {
    const map = new Map<string, number>();
    wordTokens.forEach((t, i) => map.set(t.ref, i));
    return map;
  }, [wordTokens]);

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

  const { updatePhrase } = usePhraseDispatch();

  // Revert handler: when Cancel is pressed (revert:true), restore the original tokens and return
  // to view mode. Lives here rather than in PhraseBox so it fires even when all tokens have been
  // removed from the phrase (leaving no PhraseBox with isThisPhrase=true to handle it).
  const isRevert = phraseMode.kind === 'edit' && phraseMode.revert === true;
  useEffect(() => {
    if (phraseMode.kind !== 'edit' || !isRevert) return;
    updatePhrase(phraseMode.phraseId, phraseMode.originalTokens);
    setPhraseMode({ kind: 'view' });
    // phraseMode is intentionally omitted: adding it would re-fire on every edit
    // keystroke; isRevert changing to true guarantees phraseMode holds the revert values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevert, updatePhrase, setPhraseMode]);

  // Snap the segment list to the active verse when switching modes.
  useEffect(() => {
    snapToActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  // Reseed focusedTokenRef when scrRef changes externally (e.g. Paratext verse selector). Skip
  // when focus is already inside the new verse — that case means the verse change came from a
  // token click here, and we must not clobber the clicked token with the verse's first token.
  useEffect(() => {
    const activeSeg = chapterSegments.find((seg) => seg.startRef.verse === scrRef.verseNum);
    if (focusedTokenRef && tokenSegmentMap.get(focusedTokenRef) === activeSeg?.id) return;
    /* v8 ignore next -- activeSeg is always defined when chapterSegments includes the active verse */
    setFocusedTokenRef(activeSeg?.tokens.find((t) => t.type === 'word')?.ref);
    // chapterSegments is intentionally excluded: it changes identity on every render and the
    // verse-coordinate deps already capture the change we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrRef.book, scrRef.chapterNum, scrRef.verseNum]);

  // Update scrRef when focusedTokenRef moves into a different verse (e.g. arrow nav in the
  // continuous strip). Skip when scrRef already matches — that case means scrRef and focus
  // were set together by a click and no further work is needed.
  useEffect(() => {
    if (!focusedTokenRef) return;
    const segId = tokenSegmentMap.get(focusedTokenRef);
    /* v8 ignore next -- focusedTokenRef is always set from tokens in tokenSegmentMap */
    if (!segId) return;
    const seg = segmentById.get(segId);
    /* v8 ignore next -- segmentById contains every segment id from tokenSegmentMap */
    if (!seg) return;
    if (
      seg.startRef.book === scrRef.book &&
      seg.startRef.chapter === scrRef.chapterNum &&
      seg.startRef.verse === scrRef.verseNum
    ) {
      return;
    }
    setScrRef({
      book: seg.startRef.book,
      chapterNum: seg.startRef.chapter,
      verseNum: seg.startRef.verse,
    });
    // scrRef fields are intentionally excluded: they're guards against re-firing, not triggers.
    // Adding them would re-run this effect on every external verse change without doing useful work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedTokenRef, tokenSegmentMap, segmentById, setScrRef]);

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

  return (
    <div className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
      {(phraseMode.kind === 'confirm-unlink' || phraseMode.kind === 'edit') && (
        <div className="tw:confirm-bar">
          {phraseMode.kind === 'confirm-unlink' ? (
            <UnlinkPhraseConfirm phraseId={phraseMode.phraseId} setPhraseMode={setPhraseMode} />
          ) : (
            <EditPhraseControls phraseMode={phraseMode} setPhraseMode={setPhraseMode} />
          )}
        </div>
      )}
      {continuousScroll && (
        <div className="tw:shrink-0 tw:border-b tw:border-border tw:bg-background tw:py-2">
          <ContinuousView
            book={book}
            editPhraseSegmentId={editPhraseSegmentId}
            focusedTokenRef={focusedTokenRef}
            onFocusedTokenRefChange={setFocusedTokenRef}
            phraseMode={phraseMode}
            setPhraseMode={setPhraseMode}
            tokenSegmentMap={tokenSegmentMap}
            wordTokenByRef={wordTokenByRef}
            hideInactiveLinkButtons={hideInactiveLinkButtons}
            simplifyPhrases={simplifyPhrases}
          />
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
      >
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
                tabIndex={-1}
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
                  tokenDocOrder={tokenDocOrder}
                  wordTokenByRef={wordTokenByRef}
                  hideInactiveLinkButtons={hideInactiveLinkButtons}
                  simplifyPhrases={simplifyPhrases}
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
 * @param props.hideInactiveLinkButtons - When true, link buttons between phrases are hidden in
 *   segments other than the active verse.
 * @param props.simplifyPhrases - When true, phrase-level controls are hidden on every phrase except
 *   the focused one.
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
