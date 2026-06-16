import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, TextAnalysis } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AnalysisStoreProvider, usePhraseDispatch } from './AnalysisStore';
import ContinuousView from './ContinuousView';
import EditPhraseControls from './controls/EditPhraseControls';
import useBookIndexes from '../hooks/useBookIndexes';
import useLatestRef from '../hooks/useLatestRef';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { isWordToken } from '../types/type-guards';
import { isSameVerse, toSerializedVerseRef } from '../utils/verse-ref';
import SegmentListView from './SegmentListView';
import UnlinkPhraseConfirm from './modals/UnlinkPhraseConfirm';
import { useInterlinearNav } from './InterlinearNavContext';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/**
 * Returns the ref of the first word token in `segment`, or `undefined` when the segment has none.
 * The seed value for `focusedTokenRef` whenever focus must fall back to the active verse's leading
 * word (initial mount, book change, and external verse reseed).
 *
 * @param segment - The segment to read, or `undefined` when no active segment is resolved.
 * @returns The first word token's ref, or `undefined`.
 */
function firstWordTokenRefOf(segment: Segment | undefined): string | undefined {
  return segment?.tokens.find(isWordToken)?.ref;
}

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /**
   * Current scripture reference used to highlight the active verse. Must carry a normalized verse
   * number (>= 1): production refs flow through `normalizeScrRef` in `InterlinearNavContext`, which
   * maps a verse-0 (chapter heading) selection to verse 1 before it reaches this component. A raw
   * verse-0 ref would match no segment, leaving focus unseeded and nothing highlighted.
   */
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
  /** Bundled display toggles forwarded to the segment list and continuous views. */
  viewOptions: ViewOptions;
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
 * @param props.viewOptions - Bundled display toggles forwarded to the segment list and continuous
 *   views.
 * @returns The interlinearizer layout without the provider wrapper.
 */
function InterlinearizerInner({
  book,
  continuousScroll,
  scrRef,
  phraseMode,
  setPhraseMode,
  viewOptions,
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
    () => book.segments.find((seg) => isSameVerse(seg.startRef, scrRef)),
    [book.segments, scrRef],
  );

  // Seed focusedTokenRef from the active verse on first render so the views always see a defined
  // value. An undefined focusedTokenRef would disable all link buttons (isSameSegmentAsFocus checks
  // focus.focusedSegmentId), so we never want it unset while there's a valid seed available.
  const [focusedTokenRef, setFocusedTokenRef] = useState<string | undefined>(() =>
    firstWordTokenRefOf(findActiveSegment()),
  );

  // Reseed when the book changes — the previous focusedTokenRef refers to a token from another
  // book and would never resolve in the new book's maps.
  useEffect(() => {
    setFocusedTokenRef(firstWordTokenRefOf(findActiveSegment()));
    // findActiveSegment changes with scrRef too; only re-seed on book change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // Book-wide lookup indexes the views share, built in one pass over the segment list.
  const { segmentById, tokenDocOrder, tokenSegmentMap, wordTokenByRef } = useBookIndexes(book);

  /** PhraseId currently hovered anywhere in the interlinearizer; shared across all SegmentViews. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  // Continuous-scroll mode actually rendered, passed back down to SegmentListView as the display
  // mode its segments render. A toggle defers this to the recenter midpoint so the horizontal strip
  // mounts/unmounts in lockstep with the segments' display swap — never on the old content the
  // instant the toggle flips. The fade clock lives in `useSegmentWindow` (inside SegmentListView),
  // which flips this setter inside its midpoint state batch — so the strip below mounts/unmounts in
  // the *same* React commit as the list's window rebuild, and the post-recenter re-snap measures
  // the active verse against the strip-included layout.
  const [displayContinuousScroll, setDisplayContinuousScroll] = useState(continuousScroll);

  // Fade the whole interlinearizer (strip + list) out and back in across a continuous-scroll toggle,
  // so the strip and the list animate as one unit rather than the list fading under a strip that
  // pops in/out. The toggle flips `continuousScroll` immediately but the rendered mode
  // (`displayContinuousScroll`) only catches up at the recenter midpoint; the window between the two
  // is exactly the fade-out half, so keying opacity off their mismatch gives a clean out-then-in
  // cycle on the shared clock without any extra timer here. External verse navigation never changes
  // these, so it leaves the wrapper fully opaque (the list still runs its own recenter fade).
  const isModeToggleFading = continuousScroll !== displayContinuousScroll;

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
    // keystroke; isRevert changing to true guarantees phraseMode holds the revert values — a
    // guarantee that holds only while isRevert stays derived directly from phraseMode above, so
    // don't move or memoize that derivation independently of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevert, updatePhrase, setPhraseMode]);

  // Reseed focusedTokenRef when scrRef changes externally (e.g. Paratext verse selector). Skip
  // when focus is already inside the new verse — that case means the verse change came from a
  // token click here (or a strip nav echoed back through `focusToken`), and we must not clobber the
  // deliberately-focused token with the verse's first token. A verse-exact match is intentional: an
  // external jump *within* a chapter (common in long chapters like Psalm 119) must still move focus
  // to the newly-named verse, so matching the whole chapter would wrongly strand focus. Internal
  // navigation never reaches the reseed branch here because the click/strip handler has already set
  // focus into the target verse; the fade is separately suppressed by the segment window's
  // `consumeInternalNav` (kept key-symmetric with the host echo in `InterlinearNavContext`).
  useEffect(() => {
    const activeSeg = findActiveSegment();
    if (focusedTokenRef && tokenSegmentMap.get(focusedTokenRef) === activeSeg?.id) return;
    /* v8 ignore next -- activeSeg is always defined when the book includes the active verse */
    setFocusedTokenRef(firstWordTokenRefOf(activeSeg));
    // findActiveSegment is intentionally excluded: the verse-coordinate deps already capture the
    // change we care about, and it changes identity on every scrRef update. focusedTokenRef and
    // tokenSegmentMap are excluded too — they are read only as guards; as deps they would re-run
    // this effect on every focus move and clobber the deliberately-focused token with the verse's
    // first word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrRef.book, scrRef.chapterNum, scrRef.verseNum]);

  const scrRefRef = useLatestRef(scrRef);

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
      if (isSameVerse(seg.startRef, current)) return;
      navigate(toSerializedVerseRef(seg.startRef), 'internal');
    },
    [segmentById, tokenSegmentMap, navigate, scrRefRef],
  );

  /**
   * Updates the active scripture reference (when the verse actually changed) and, when a specific
   * token was clicked, focuses that token. Skips the write to PAPI when the clicked verse matches
   * the current one, avoiding a gratuitous echo round-trip.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenRef - The token that was clicked; omitted when the whole segment was selected.
   */
  const handleSegmentSelect = useCallback(
    (ref: ScriptureRef, tokenRef?: string) => {
      const { current } = scrRefRef;
      if (!isSameVerse(ref, current)) {
        navigate(toSerializedVerseRef(ref), 'internal');
      }
      if (tokenRef) setFocusedTokenRef(tokenRef);
    },
    [navigate, scrRefRef],
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
      <div
        className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:transition-opacity"
        style={{ opacity: isModeToggleFading ? 0 : 1, ...RECENTER_FADE_TRANSITION_STYLE }}
      >
        {displayContinuousScroll && (
          <div className="tw:shrink-0 tw:border-b tw:border-border tw:bg-background tw:py-2">
            <ContinuousView
              book={book}
              editPhraseSegmentId={editPhraseSegmentId}
              focusedTokenRef={focusedTokenRef}
              onFocusedTokenRefChange={focusToken}
              phraseMode={phraseMode}
              setPhraseMode={setPhraseMode}
              tokenSegmentMap={tokenSegmentMap}
              tokenDocOrder={tokenDocOrder}
              wordTokenByRef={wordTokenByRef}
              viewOptions={viewOptions}
            />
          </div>
        )}

        <SegmentListView
          book={book}
          scrRef={scrRef}
          focusedTokenRef={focusedTokenRef}
          continuousScroll={continuousScroll}
          displayContinuousScroll={displayContinuousScroll}
          onDisplayContinuousScrollChange={setDisplayContinuousScroll}
          consumeInternalNav={consumeInternalNav}
          reportSettled={reportSettled}
          phraseMode={phraseMode}
          setPhraseMode={setPhraseMode}
          viewOptions={viewOptions}
          hoveredPhraseId={hoveredPhraseId}
          setHoveredPhraseId={setHoveredPhraseId}
          editPhraseSegmentId={editPhraseSegmentId}
          onSelect={handleSegmentSelect}
          tokenSegmentMap={tokenSegmentMap}
          tokenDocOrder={tokenDocOrder}
          wordTokenByRef={wordTokenByRef}
        />
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
 * @param props.scrRef - Current scripture reference; must be normalized (verse >= 1, see
 *   {@link InterlinearizerProps}).
 * @param props.initialAnalysis - Seed analysis data for the store; not reactive after mount
 * @param props.analysisLanguage - BCP 47 tag for gloss read/write
 * @param props.onSaveAnalysis - Called after each gloss write with the updated `TextAnalysis`
 * @param props.phraseMode - Current phrase-interaction mode owned by the parent
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.viewOptions - Bundled display toggles forwarded to the segment list and continuous
 *   views.
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
