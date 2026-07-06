import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, TextAnalysis } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  AnalysisStoreProvider,
  usePhraseDispatch,
  usePhraseLinkByIdGetter,
  usePhraseLinkByIdMap,
} from './AnalysisStore';
import {
  NO_OP_SEGMENTATION_DISPATCH,
  SegmentationProvider,
  type SegmentationContextValue,
  type SegmentationDispatch,
} from './SegmentationStore';
import ContinuousView from './ContinuousView';
import EditPhraseControls from './controls/EditPhraseControls';
import useBookIndexes from '../hooks/useBookIndexes';
import useLatestRef from '../hooks/useLatestRef';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { isWordToken } from '../types/type-guards';
import { phrasesStraddlingBoundary, splitPhraseAtBoundary } from '../utils/phrase-arc';
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

/** Stable empty map used as the `formerBoundaries` default so memoization isn't broken. */
const EMPTY_FORMER_BOUNDARIES: ReadonlyMap<string, string> = new Map();

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /**
   * Current scripture reference used to highlight the active verse. Always names a verse some
   * segment in `book` starts at, provided the referenced chapter has segments: the loader keeps
   * `verseNum: 0` when the active chapter has a verse-0 superscription segment (so the
   * superscription becomes the active verse), resolves a whole-chapter (verse 0) selection to the
   * chapter's first numbered verse, and resolves any other unmatched verse — the host's next-verse
   * button past the chapter's end, or a verse inside a multi-verse segment — to the nearest
   * preceding segment start in the chapter. So this is normally verse >= 1, and is verse 0 only
   * when a matching verse-0 segment exists.
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
  /**
   * Called with whether any gloss input currently holds uncommitted text, so the caller can show
   * the unsaved indicator while the user is typing — before the edit commits on blur.
   */
  onPendingEditsChange?: (pending: boolean) => void;
  /** Current phrase-interaction mode; owned by the parent and passed down for rendering. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed down so child components can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Bundled display toggles forwarded to the segment list and continuous views. */
  viewOptions: ViewOptions;
  /**
   * When true, un-approved tokens render the engine's derived suggestion with accept / promote
   * affordances. Forwarded straight to {@link AnalysisStoreProvider}. Defaults to `false`.
   */
  showSuggestions?: boolean;
  /**
   * Boundary-editing operations provided to the views via {@link SegmentationProvider}. Optional so
   * isolated tests can omit it; the real loader always supplies it. Defaults to an inert no-op.
   */
  segmentationDispatch?: SegmentationDispatch;
  /**
   * Maps each merged-away default verse boundary's word-token split anchor (the verse's first word
   * token) to the removed default start ref, provided to the views via {@link SegmentationProvider}
   * so slots on those anchors render the former-boundary tick and a split there restores the
   * original boundary exactly. Optional so isolated tests can omit it; defaults to an empty map.
   */
  formerBoundaries?: ReadonlyMap<string, string>;
  /**
   * Monotonic counter the loader bumps on every boundary edit. Threaded to the segment window so it
   * can tell a boundary edit (redraw in place) apart from a re-tokenization of the loaded book
   * (recenter with a fade) when the segments identity changes. Optional so isolated tests can omit
   * it; defaults to `0`.
   */
  segmentationVersion?: number;
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
  segmentationDispatch = NO_OP_SEGMENTATION_DISPATCH,
  formerBoundaries = EMPTY_FORMER_BOUNDARIES,
  segmentationVersion = 0,
}: Omit<
  InterlinearizerProps,
  'initialAnalysis' | 'analysisLanguage' | 'onSaveAnalysis' | 'showSuggestions'
>) {
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

  // Book-wide lookup indexes the views share, built in one pass over the segment list.
  const {
    segmentById,
    segmentOrder,
    tokenDocOrder,
    fullTokenOrder,
    tokenSegmentMap,
    wordTokenByRef,
    wordRefByOrder,
  } = useBookIndexes(book);

  // Reseed when the new book no longer resolves the focused token — a real book change (the
  // previous focusedTokenRef names a token from another book) or a re-tokenization that dropped the
  // token. A boundary edit (merge/split) also produces a fresh `book` object, but token refs
  // survive re-segmentation, so a still-resolving focus must be kept: reseeding would snap the
  // continuous strip to the active verse's first word — or park it on the book's very first phrase
  // when a merge removed the active verse's segment start (no segment startRef names that verse
  // anymore, so findActiveSegment returns undefined).
  useEffect(() => {
    setFocusedTokenRef((current) =>
      current !== undefined && wordTokenByRef.has(current)
        ? current
        : firstWordTokenRefOf(findActiveSegment()),
    );
    // findActiveSegment changes with scrRef too, and wordTokenByRef derives from book; only re-seed
    // on book change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const phraseDispatch = usePhraseDispatch();
  const getPhraseLinkById = usePhraseLinkByIdGetter();
  const phraseLinkById = usePhraseLinkByIdMap();

  /**
   * Word-token refs where placing a segment boundary would cut a phrase — the not-mid-phrase UI
   * guard, precomputed once per phrase-link change. A boundary before ref `W` cuts a phrase when
   * the phrase has tokens both strictly before and at-or-after `W`, i.e. every word ref strictly
   * inside the phrase's document-order span `(min, max]` — including refs in the gaps of a
   * discontiguous phrase. Computed here (one store subscription, one pass over the links) instead
   * of per boundary slot, so hover-driven strip re-renders do O(1) set lookups rather than each
   * slot rescanning every phrase link.
   */
  const straddledBoundaryRefs = useMemo<ReadonlySet<string>>(() => {
    const blocked = new Set<string>();
    phraseLinkById.forEach((link) => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      link.tokens.forEach((t) => {
        const order = tokenDocOrder.get(t.tokenRef);
        /* v8 ignore next -- phrase tokens are word tokens, which the doc-order map always contains */
        if (order === undefined) return;
        if (order < min) min = order;
        if (order > max) max = order;
      });
      for (let i = min + 1; i <= max; i += 1) blocked.add(wordRefByOrder[i]);
    });
    return blocked;
  }, [phraseLinkById, tokenDocOrder, wordRefByOrder]);

  /**
   * Splits every phrase that a new segment boundary before `boundaryRef` would cut, so no phrase
   * ever spans two segments. Reads the phrase links at call time (not via subscription) and applies
   * {@link splitPhraseAtBoundary} at each straddled phrase's boundary-side split point.
   *
   * @param boundaryRef - Token ref the new segment will begin at.
   */
  const forceBreakStraddledPhrases = useCallback(
    (boundaryRef: string) => {
      phrasesStraddlingBoundary(boundaryRef, getPhraseLinkById().values(), fullTokenOrder).forEach(
        ({ link, splitAfterTokenRef }) =>
          splitPhraseAtBoundary(link, splitAfterTokenRef, phraseDispatch, tokenDocOrder),
      );
    },
    [getPhraseLinkById, fullTokenOrder, phraseDispatch, tokenDocOrder],
  );

  /**
   * The dispatch the views receive: wraps the raw boundary writer so any operation that adds a
   * boundary (split, and the add-half of move) first force-breaks the phrases the new boundary
   * would cut. Merge only removes a boundary, which can never leave a phrase straddling segments,
   * so it passes through. The token-chip views suppress their controls at straddling boundaries via
   * the same predicate, so the force-break normally fires only for callers that cannot see
   * phrases.
   */
  const dispatch = useMemo<SegmentationDispatch>(
    () => ({
      merge: segmentationDispatch.merge,
      split: (tokenRef) => {
        forceBreakStraddledPhrases(tokenRef);
        segmentationDispatch.split(tokenRef);
      },
      move: (fromRef, toRef) => {
        forceBreakStraddledPhrases(toRef);
        segmentationDispatch.move(fromRef, toRef);
      },
    }),
    [segmentationDispatch, forceBreakStraddledPhrases],
  );

  /** Segmentation context shared by the views — the dispatch plus the lookups its call sites need. */
  const segmentationValue = useMemo<SegmentationContextValue>(
    () => ({
      dispatch,
      segmentById,
      segmentOrder,
      formerBoundaries,
      straddledBoundaryRefs,
    }),
    [dispatch, segmentById, segmentOrder, formerBoundaries, straddledBoundaryRefs],
  );

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
   * A verse-0 segment (a chapter superscription) navigates like any other verse: the `'internal'`
   * origin records a nav marker so the segment window recognizes the host's echo as our own move
   * and skips the recenter fade (the target is already on screen).
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
   * the current one, avoiding a gratuitous echo round-trip. A verse-0 segment (a chapter
   * superscription) writes like any other verse — the `'internal'` origin records a nav marker so
   * the segment window skips the recenter fade for our own move.
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
    <SegmentationProvider value={segmentationValue}>
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
            segmentationVersion={segmentationVersion}
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
    </SegmentationProvider>
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
 * @param props.scrRef - Current scripture reference; always names a verse with a segment (verse 0
 *   only when a superscription segment exists, see {@link InterlinearizerProps}).
 * @param props.initialAnalysis - Seed analysis data for the store; not reactive after mount
 * @param props.analysisLanguage - BCP 47 tag for gloss read/write
 * @param props.onSaveAnalysis - Called after each gloss write with the updated `TextAnalysis`
 * @param props.onPendingEditsChange - Called with whether any gloss input currently holds
 *   uncommitted text, so the caller can show the unsaved indicator while the user types
 * @param props.phraseMode - Current phrase-interaction mode owned by the parent
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.viewOptions - Bundled display toggles forwarded to the segment list and continuous
 *   views.
 * @param props.showSuggestions - When true, un-approved tokens render the engine's derived
 *   suggestion with accept / promote affordances; forwarded to {@link AnalysisStoreProvider}.
 * @returns The full interlinearizer layout with optional continuous strip and segment list
 */
export default function Interlinearizer({
  initialAnalysis,
  analysisLanguage,
  onSaveAnalysis,
  onPendingEditsChange,
  showSuggestions = false,
  ...innerProps
}: InterlinearizerProps) {
  return (
    <AnalysisStoreProvider
      initialAnalysis={initialAnalysis}
      analysisLanguage={analysisLanguage}
      onSave={onSaveAnalysis}
      onPendingEditsChange={onPendingEditsChange}
      showSuggestions={showSuggestions}
    >
      <InterlinearizerInner {...innerProps} />
    </AnalysisStoreProvider>
  );
}
