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
import useSegmentWindow from '../hooks/useSegmentWindow';
import { RECENTER_FADE_EASING, RECENTER_FADE_MS } from './recenter-fade';
import { useInterlinearNav } from './InterlinearNavContext';

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /** Current scripture reference used to highlight the active verse. */
  scrRef: SerializedVerseRef;
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
 * @param props.continuousScroll - When true, the horizontal token strip is shown above the segment
 *   list.
 * @param props.scrRef - Current scripture reference used to highlight the active verse.
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
  continuousScroll,
  scrRef,
  phraseMode,
  setPhraseMode,
  hideInactiveLinkButtons,
  simplifyPhrases,
}: Omit<InterlinearizerProps, 'initialAnalysis' | 'analysisLanguage' | 'onSaveAnalysis'>) {
  // Navigation surface from the context: `navigate` writes the reference (classifying internal vs
  // external at the call site), `consumeInternalNav` lets the segment window suppress the fade for
  // internal moves, and `reportSettled` lifts the cross-book curtain once the new book is laid out.
  const { navigate, consumeInternalNav, reportSettled } = useInterlinearNav();

  /**
   * Finds the book segment that owns the active verse named by `scrRef`, matching on book, chapter,
   * and verse. Book must be matched too: during an external navigation the new `scrRef.book` is set
   * before its book data finishes loading, so the still-mounted `book` belongs to the previous
   * reference. A chapter+verse-only match would then resolve to the wrong book's verse (e.g.
   * Genesis 15 while navigating to Matthew 15), seed `focusedTokenRef` from it, and the echo-back
   * effect would fire that wrong-book verse back as `scrRef`, corrupting the global reference.
   * Returning `undefined` until the matching book is mounted keeps focus unset rather than wrong.
   *
   * @returns The active verse's segment, or `undefined` when no segment matches.
   */
  const findActiveSegment = useCallback(
    () =>
      book.segments.find(
        (seg) =>
          seg.startRef.book === scrRef.book &&
          seg.startRef.chapter === scrRef.chapterNum &&
          seg.startRef.verse === scrRef.verseNum,
      ),
    [book.segments, scrRef.book, scrRef.chapterNum, scrRef.verseNum],
  );

  // Seed focusedTokenRef from the active verse on first render so the views always see a defined
  // value. An undefined focusedTokenRef would disable all link buttons (isSameSegmentAsFocus checks
  // focus.focusedSegmentId), so we never want it unset while there's a valid seed available.
  const [focusedTokenRef, setFocusedTokenRef] = useState<string | undefined>(
    () => findActiveSegment()?.tokens.find((t) => t.type === 'word')?.ref,
  );

  // Reseed when the book changes — the previous focusedTokenRef refers to a token from another
  // book and would never resolve in the new book's maps.
  useEffect(() => {
    setFocusedTokenRef(findActiveSegment()?.tokens.find((t) => t.type === 'word')?.ref);
    // findActiveSegment changes with scrRef too; only re-seed on book change.
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
   * Recenters the segment list on the active verse with the same fade-and-rebuild used for external
   * navigation. Used by the LocateFixed button and the continuous-scroll mode switch. Always fades
   * (even when the verse is already on screen) so the active verse is guaranteed to land in view —
   * a plain `scrollIntoView` of an `aria-current` element silently no-ops when the verse is outside
   * the render window, leaving the list parked wherever it was.
   *
   * `recenterOnActive` is captured via ref so this callback's identity stays stable.
   */
  const recenterOnActiveRef = useRef<() => void>(() => undefined);
  const snapToActive = useCallback(() => {
    recenterOnActiveRef.current();
  }, []);

  // Scroll-anchored window into the full book's segment list. Spans chapters, grows/culls at the
  // scrolled edge, and recenters (with a fade) on the active verse when navigation arrives from
  // outside the list.
  const {
    windowSegments,
    isFaded,
    displayScrRef,
    displayFocusedTokenRef,
    topSentinelRef,
    bottomSentinelRef,
    recenterOnActive,
  } = useSegmentWindow({
    book,
    scrRef,
    focusedTokenRef,
    scrollContainerRef,
    consumeInternalNav,
    onSettled: reportSettled,
  });
  recenterOnActiveRef.current = recenterOnActive;

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

  // Recenter the segment list on the active verse when switching between continuous and segment
  // modes. Skips the initial mount: the window is already built centered on the anchor there, so a
  // recenter would needlessly fade. Only an actual mode toggle should fade-and-recenter.
  const didMountModeSwitchRef = useRef(false);
  useEffect(() => {
    if (!didMountModeSwitchRef.current) {
      didMountModeSwitchRef.current = true;
      return;
    }
    snapToActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  // Reseed focusedTokenRef when scrRef changes externally (e.g. Paratext verse selector). Skip
  // when focus is already inside the new verse — that case means the verse change came from a
  // token click here, and we must not clobber the clicked token with the verse's first token.
  useEffect(() => {
    const activeSeg = findActiveSegment();
    if (focusedTokenRef && tokenSegmentMap.get(focusedTokenRef) === activeSeg?.id) return;
    /* v8 ignore next -- activeSeg is always defined when the book includes the active verse */
    setFocusedTokenRef(activeSeg?.tokens.find((t) => t.type === 'word')?.ref);
    // findActiveSegment is intentionally excluded: the verse-coordinate deps already capture the
    // change we care about, and it changes identity on every scrRef update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrRef.book, scrRef.chapterNum, scrRef.verseNum]);

  // Latest scrRef, mirrored so `focusToken` can read the current verse without taking it as a dep
  // (scrRef is a fresh object on many host renders; depending on it would churn focusToken's
  // identity and re-wire ContinuousView's callback ref every render).
  const scrRefRef = useRef(scrRef);
  scrRefRef.current = scrRef;

  /**
   * Focuses `tokenRef` and, when it lives in a different verse than the active one, navigates
   * there. The single explicit focus-move operation behind strip arrow nav and phrase clicks: it
   * both sets the focused token and pushes the verse change as an _internal_ navigation (so the
   * segment window tracks along without a recenter fade). Replaces the former focus→scrRef "echo"
   * effect, which watched `focusedTokenRef` and re-derived the navigation after the fact; doing it
   * inline removes that indirection.
   *
   * Never navigates when the focused token's book differs from the active `scrRef`'s book: during
   * an external book change `scrRef` can briefly name the new book while the mounted book (and this
   * token) still belong to the previous one, and echoing that stale verse would overwrite the new
   * reference. (The loader's `viewScrRef` freeze normally keeps the two in sync, so this guards a
   * transient.)
   *
   * @param tokenRef - The word-token ref to focus.
   */
  const focusToken = useCallback(
    (tokenRef: string) => {
      setFocusedTokenRef(tokenRef);
      const segId = tokenSegmentMap.get(tokenRef);
      /* v8 ignore next 2 -- tokenRef always resolves to a segment in the mounted book */
      const seg = segId === undefined ? undefined : segmentById.get(segId);
      if (!seg) return;
      const { current } = scrRefRef;
      if (seg.startRef.book !== current.book) return;
      if (seg.startRef.chapter === current.chapterNum && seg.startRef.verse === current.verseNum) {
        return;
      }
      navigate(
        { book: seg.startRef.book, chapterNum: seg.startRef.chapter, verseNum: seg.startRef.verse },
        'internal',
      );
    },
    [segmentById, tokenSegmentMap, navigate],
  );

  /**
   * Updates the active scripture reference and, when a specific token was clicked, focuses that
   * token.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenRef - The token that was clicked; omitted when the whole segment was selected.
   */
  const handleSegmentSelect = useCallback(
    (ref: ScriptureRef, tokenRef?: string) => {
      const newScrRef = { book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse };
      // Classify as internal navigation so the segment window skips its recenter fade: the clicked
      // verse is already on screen, so fading and rebuilding would be a jarring no-op.
      navigate(newScrRef, 'internal');
      if (tokenRef) setFocusedTokenRef(tokenRef);
    },
    [navigate],
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
            onFocusedTokenRefChange={focusToken}
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
        className="tw:no-scrollbar tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
      >
        {windowSegments.length === 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            No verse data for {scrRef.book} {scrRef.chapterNum}.
          </p>
        )}

        {windowSegments.length > 0 && (
          <>
            <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:justify-end tw:pointer-events-none">
              <button
                aria-label="Scroll to active verse"
                className="tw:rounded tw:p-1 tw:text-foreground tw:bg-background tw:hover:bg-muted/50 tw:pointer-events-auto"
                tabIndex={-1}
                onClick={snapToActive}
                type="button"
              >
                <LocateFixed className="tw:h-4 tw:w-4" />
              </button>
            </div>

            <div
              className="tw:flex tw:flex-col tw:gap-2 tw:transition-opacity"
              style={{
                opacity: isFaded ? 0 : 1,
                transitionDuration: `${RECENTER_FADE_MS}ms`,
                transitionTimingFunction: RECENTER_FADE_EASING,
              }}
            >
              <div ref={topSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
              {windowSegments.map((seg) => (
                <MemoizedSegmentView
                  key={seg.id}
                  displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                  editPhraseSegmentId={editPhraseSegmentId}
                  focusedTokenRef={continuousScroll ? undefined : displayFocusedTokenRef}
                  hoveredPhraseId={hoveredPhraseId}
                  isActive={
                    seg.startRef.book === displayScrRef.book &&
                    seg.startRef.chapter === displayScrRef.chapterNum &&
                    seg.startRef.verse === displayScrRef.verseNum
                  }
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
              <div ref={bottomSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
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
 * @param props.book - Book data used by the continuous view and segment window
 * @param props.continuousScroll - Whether the continuous scroll view is shown
 * @param props.scrRef - Current scripture reference
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
