import { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment } from 'interlinearizer';
import { TooltipProvider } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseDispatch, usePhraseLinkByIdGetter, usePhraseLinkByIdMap } from './AnalysisStore';
import {
  NO_OP_SEGMENTATION_DISPATCH,
  SegmentationProvider,
  type SegmentationContextValue,
  type SegmentationDispatch,
} from './SegmentationStore';
import ContinuousView from './ContinuousView';
import { AltHeldProvider } from './AltHeldContext';
import EditPhraseControls from './controls/EditPhraseControls';
import useBookIndexes from '../hooks/useBookIndexes';
import { useAltHeld } from '../hooks/useAltHeld';
import useLatestRef from '../hooks/useLatestRef';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { isWordToken } from '../types/type-guards';
import { phrasesStraddlingBoundary, splitPhraseAtBoundary } from '../utils/phrase-arc';
import { isSameVerse, segmentContainsVerse, toSerializedVerseRef } from '../utils/verse-ref';
import SegmentListView from './SegmentListView';
import UnlinkPhraseConfirm from './modals/UnlinkPhraseConfirm';
import { useInterlinearNav } from './InterlinearNavContext';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/**
 * Returns the ref of the first word token in `segment`, or `undefined` when the segment has none.
 * Used to seed `focusedTokenRef` from the active verse's leading word.
 *
 * @param segment - The segment to read, or `undefined` when no active segment is resolved.
 */
function firstWordTokenRefOf(segment: Segment | undefined): string | undefined {
  return segment?.tokens.find(isWordToken)?.ref;
}

/** Stable empty map used as the `formerBoundaries` default so memoization holds. */
const EMPTY_FORMER_BOUNDARIES: ReadonlyMap<string, string> = new Map();

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /**
   * Current scripture reference used to highlight the active verse. The loader resolves this to a
   * verse contained in some segment of `book` (when the chapter has segments): normally verse >= 1,
   * and verse 0 only when a matching verse-0 superscription segment exists.
   */
  scrRef: SerializedVerseRef;
  /** Current phrase-interaction mode; owned by the parent and passed down for rendering. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed down so child components can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Bundled display toggles forwarded to the segment list and continuous views. */
  viewOptions: ViewOptions;
  /**
   * Boundary-editing operations provided via {@link SegmentationProvider}. Optional so isolated
   * tests can omit it; the real loader always supplies it. Defaults to an inert no-op.
   */
  segmentationDispatch?: SegmentationDispatch;
  /**
   * Maps each merged-away default verse boundary's word-token split anchor (the verse's first word
   * token) to the removed default start ref, so slots on those anchors render the former-boundary
   * tick and a split there restores the original boundary exactly. Optional so isolated tests can
   * omit it; defaults to an empty map.
   */
  formerBoundaries?: ReadonlyMap<string, string>;
  /**
   * Monotonic counter the loader bumps on every boundary edit. Lets the segment window tell a
   * boundary edit (redraw in place) apart from a re-tokenization of the loaded book (recenter with
   * a fade) when the segments identity changes. Optional so isolated tests can omit it; defaults to
   * `0`.
   */
  segmentationVersion?: number;
}>;

/**
 * Renders the interlinear view for one book: an optional continuous token strip above a segment
 * list. Reads and writes analysis through the store its caller mounts, and expects to be remounted
 * on a book change — the store deliberately outlives that remount, since it holds the whole draft.
 */
export default function Interlinearizer({
  book,
  continuousScroll,
  scrRef,
  phraseMode,
  setPhraseMode,
  viewOptions,
  segmentationDispatch = NO_OP_SEGMENTATION_DISPATCH,
  formerBoundaries = EMPTY_FORMER_BOUNDARIES,
  segmentationVersion = 0,
}: InterlinearizerProps) {
  // Navigation surface from the context: `navigate` writes the reference (classifying internal vs
  // external at the call site), `consumeInternalNav` lets the segment window suppress the fade for
  // internal moves, `reportSettled` lifts the cross-book curtain once the new book is laid out, and
  // `consumeFocusRequest` / `pendingFocusToken` collect a token focus asked for from outside the
  // views.
  const { navigate, consumeInternalNav, reportSettled, consumeFocusRequest, pendingFocusToken } =
    useInterlinearNav();

  // Whether Alt is currently held. Provided through a dedicated context (not the memoized
  // SegmentationContext) so an Alt press re-renders only the split-gap markers that consume it.
  const altHeld = useAltHeld();

  /**
   * Finds the book segment that owns the active verse named by `scrRef`: the first segment in
   * document order whose verse range contains it. Containment (rather than an exact start-verse
   * match) matters after boundary edits — a verse absorbed into a multi-verse segment, or named by
   * a later portion of a split verse, still resolves to the segment that holds its text.
   * `segmentContainsVerse` also matches the book, so during a cross-book navigation (where `scrRef`
   * names the new book before its data loads, leaving `book` still the previous one) this returns
   * `undefined` rather than resolving to the wrong book's verse.
   */
  const findActiveSegment = useCallback(
    () => book.segments.find((seg) => segmentContainsVerse(seg, scrRef)),
    [book.segments, scrRef],
  );

  // Seed focusedTokenRef from the active verse on first render so it is never undefined: an
  // undefined focusedTokenRef would disable all link buttons (isSameSegmentAsFocus checks
  // focus.focusedSegmentId).
  const [focusedTokenRef, setFocusedTokenRef] = useState<string | undefined>(() =>
    firstWordTokenRefOf(findActiveSegment()),
  );

  // Book-wide lookup indexes.
  const {
    segmentById,
    segmentOrder,
    tokenDocOrder,
    fullTokenOrder,
    tokenSegmentMap,
    wordTokenByRef,
    wordRefByOrder,
  } = useBookIndexes(book);

  // Reseed only when the new book no longer resolves the focused token — a book change, or a
  // re-tokenization that dropped the token. A boundary edit (merge/split) also produces a fresh
  // `book`, but token refs survive re-segmentation, so a still-resolving focus is kept to avoid
  // snapping the strip back to the active verse's first word.
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
   * guard, precomputed once per phrase-link change so boundary slots do O(1) set lookups. A
   * boundary before ref `W` cuts a phrase when the phrase has tokens both strictly before and
   * at-or-after `W`, i.e. every word ref strictly inside the phrase's document-order span `(min,
   * max]` — including refs in the gaps of a discontiguous phrase.
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
   * The dispatch provided through the segmentation context: wraps the raw boundary writer so any
   * operation that adds a boundary (split, and the add-half of move) first force-breaks the phrases
   * the new boundary would cut. Merge only removes a boundary, which can never leave a phrase
   * straddling segments, so it passes through.
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

  /** Segmentation context value — the dispatch paired with the lookups it operates over. */
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

  // Continuous-scroll mode actually rendered. A toggle defers this to the recenter midpoint (the fade
  // clock lives in `useSegmentWindow`, which flips this setter inside its midpoint state batch) so
  // the strip mounts/unmounts in the same React commit as the list's window rebuild, and the
  // post-recenter re-snap measures the active verse against the strip-included layout.
  const [displayContinuousScroll, setDisplayContinuousScroll] = useState(continuousScroll);

  // True while a continuous-scroll toggle is mid-flight: `continuousScroll` flips immediately but
  // `displayContinuousScroll` only catches up at the recenter midpoint, and that window is exactly
  // the fade-out half. Keying wrapper opacity off the mismatch fades strip + list as one unit on the
  // shared recenter clock with no extra timer. External verse navigation never changes these, so it
  // leaves the wrapper opaque (the list still runs its own recenter fade).
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

  // On Cancel (revert:true), restore the original tokens and return to view mode. Lives here rather
  // than in PhraseBox so it fires even when all tokens have been removed from the phrase (leaving no
  // PhraseBox with isThisPhrase=true to handle it).
  const isRevert = phraseMode.kind === 'edit' && phraseMode.revert === true;
  useEffect(() => {
    if (phraseMode.kind !== 'edit' || !isRevert) return;
    updatePhrase(phraseMode.phraseId, phraseMode.originalTokens);
    setPhraseMode({ kind: 'view' });
    // phraseMode is intentionally omitted: adding it would re-fire on every edit keystroke. isRevert
    // becoming true guarantees phraseMode holds the revert values — a guarantee that holds only
    // while isRevert stays derived directly from phraseMode above, so don't move or memoize that
    // derivation independently of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevert, updatePhrase, setPhraseMode]);

  // Reseed focusedTokenRef when scrRef changes externally (e.g. Paratext verse selector). Skip when
  // the focused token's *own* segment already contains the new verse — that means the change came
  // from a token click / strip nav here, and reseeding would clobber the deliberately-focused token.
  // The guard tests the focused token's own segment (not the active segment's id) so that clicking a
  // non-first portion of a split verse doesn't get reseeded to the verse's first portion. Internal
  // navigation always hits the skip branch because the handler has already set focus into the target
  // verse.
  useEffect(() => {
    const focusedSegId = focusedTokenRef ? tokenSegmentMap.get(focusedTokenRef) : undefined;
    const focusedSeg = focusedSegId ? segmentById.get(focusedSegId) : undefined;
    if (focusedSeg && segmentContainsVerse(focusedSeg, scrRef)) return;
    /* v8 ignore next -- activeSeg is always defined when the book includes the active verse */
    setFocusedTokenRef(firstWordTokenRefOf(findActiveSegment()));
    // findActiveSegment is intentionally excluded: the verse-coordinate deps already capture the
    // change we care about, and it changes identity on every scrRef update. focusedTokenRef,
    // tokenSegmentMap, and segmentById are excluded too — they are read only as guards; as deps they
    // would re-run this effect on every focus move and clobber the deliberately-focused token with
    // the verse's first word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrRef.book, scrRef.chapterNum, scrRef.verseNum]);

  // Claim a focus asked for from outside the views. Declared after both reseed effects above so it
  // wins: they run first in the same commit, and the scrRef reseed reads a focus closure that
  // predates the book reseed, so its own guard cannot see this claim. Claimed in an effect rather
  // than the seed above so the claim lands after commit, never during a render React may discard.
  // It re-runs whenever the book object changes identity — a boundary edit re-segments it — which is
  // harmless: claiming clears the request, so a repeat call finds nothing left to claim.
  useEffect(() => {
    const requested = consumeFocusRequest(book.bookRef);
    if (requested === undefined) return;
    if (wordTokenByRef.has(requested)) {
      setFocusedTokenRef(requested);
      return;
    }
    // A ref this book cannot resolve is dropped rather than held for a later attempt: one that
    // outlived the load it was made for would fire on an unrelated navigation, long after the
    // click that raised it. Logged because the drop is otherwise invisible.
    logger.warn(`Interlinearizer: focus request "${requested}" matched no word token`);
    // Both deps are needed: the request is the only signal when it names the verse already on
    // screen, and the book is the only signal when it named a book that had yet to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, pendingFocusToken]);

  const scrRefRef = useLatestRef(scrRef);

  /**
   * Focuses `tokenRef` and, when it lives in a different verse than the active one, navigates
   * there. The single explicit focus-move operation behind strip arrow nav and phrase clicks: it
   * sets the focused token and pushes the verse change as an _internal_ navigation (so the segment
   * window tracks along without a recenter fade). A verse-0 segment (a chapter superscription)
   * navigates like any other verse.
   *
   * Never navigates when the focused token's book differs from the active `scrRef`'s book: during
   * an external book change `scrRef` can briefly name the new book while the mounted book (and this
   * token) still belong to the previous one, and echoing that stale verse would overwrite the new
   * reference.
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
      // Containment check (not exact start-verse match): focusing another token of the segment that
      // already holds the active verse must not renavigate to the segment's start verse.
      if (segmentContainsVerse(seg, current)) return;
      navigate(toSerializedVerseRef(seg.startRef), 'internal');
    },
    [segmentById, tokenSegmentMap, navigate, scrRefRef],
  );

  /**
   * Updates the active scripture reference (when the verse actually changed) and, when a specific
   * token was clicked, focuses that token. Skips the write to PAPI when the clicked verse matches
   * the current one, avoiding a gratuitous echo round-trip. A verse-0 segment (a chapter
   * superscription) writes like any other verse.
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
    <AltHeldProvider value={altHeld}>
      <TooltipProvider delayDuration={700}>
        <SegmentationProvider value={segmentationValue}>
          <div className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
            {(phraseMode.kind === 'confirm-unlink' || phraseMode.kind === 'edit') && (
              <div className="tw:confirm-bar">
                {phraseMode.kind === 'confirm-unlink' ? (
                  <UnlinkPhraseConfirm
                    phraseId={phraseMode.phraseId}
                    setPhraseMode={setPhraseMode}
                  />
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
      </TooltipProvider>
    </AltHeldProvider>
  );
}
