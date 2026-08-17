import { useLocalizedStrings } from '@papi/frontend/react';
import type { Book, Token } from 'interlinearizer';
import { Button } from 'platform-bible-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useArcPaths } from '../hooks/useArcPaths';
import { usePhraseHoverState } from '../hooks/usePhraseHoverState';
import type { PhraseMode } from '../types/phrase-mode';
import type { LinkSlot, TokenGroup } from '../types/token-layout';
import type { ViewOptions } from '../types/view-options';
import { resolvedOrEmpty } from '../utils/localized-strings';
import { buildRenderUnits, groupTokens, resolveFocusContext } from '../utils/token-layout';
import { buildVerseStartLabelsByTokenRef, slotVerseLabel } from '../utils/verse-superscripts';
import { usePhraseLinkByIdMap, usePhraseLinkMap } from './AnalysisStore';
import { PhraseStripProvider } from './PhraseStripContext';
import { PhraseStrip, LINK_SLOT_TRANSITION_MS, type StripItem } from './PhraseStripParts';
import {
  useArcSplitHandler,
  useCandidatePhraseIds,
  useEditPhraseTokens,
  usePhraseStripContextValue,
} from '../hooks/usePhraseStripSetup';
import useLatestRef from '../hooks/useLatestRef';
import usePhraseWindowHalf from '../hooks/usePhraseWindowHalf';
import MemoizedArcOverlay from './ArcOverlay';
import { RECENTER_FADE_MS, RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/** Clamps `index` to `[0, len - 1]`, returning `0` when `len` is zero. */
function clampIndex(index: number, len: number): number {
  /* v8 ignore next -- only called when len > 0; guard is a defensive invariant */
  if (len === 0) return 0;
  return Math.max(0, Math.min(index, len - 1));
}

/**
 * Backstop, in milliseconds, for committing the deferred inactive-link relayout after an
 * internal-nav smooth scroll. The relayout normally fires on the scroll container's `scrollend`
 * event (adaptive to however long the animation actually takes); this timeout only fires when
 * `scrollend` is unavailable or never emitted (the target was already centered, so no scroll
 * occurred). Sized to comfortably outlast a one-phrase smooth scroll on slow hardware so it never
 * preempts a real `scrollend`.
 */
const SCROLL_SETTLE_FALLBACK_MS = 600;

/**
 * Hard cap (ms) on how long the focused phrase is held re-centered after an instant jump. The hold
 * normally ends a short quiet period after the strip's last content reflow (glosses, morpheme rows,
 * and arcs settling asynchronously push the focus sideways for a while); this cap bounds the total
 * so a strip that never fully stabilizes cannot spin the rAF loop indefinitely. Sized to
 * comfortably outlast the observed settle on slow hardware.
 */
const HOLD_CENTERED_MAX_MS = 2_000;

/**
 * Localized string keys this view needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders. A fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render, escalating into an infinite update loop that freezes
 * the WebView.
 */
const STRING_KEYS = [
  '%interlinearizer_linkButton_crossSegmentDisabledTooltip%',
  '%interlinearizer_linkButton_link%',
  '%interlinearizer_linkButton_unlink%',
  '%interlinearizer_boundaryControl_merge%',
  '%interlinearizer_boundaryControl_mergeAltHint%',
  '%interlinearizer_boundaryControl_split%',
  '%interlinearizer_phraseBox_glossLabel%',
  '%interlinearizer_phraseBox_edit%',
  '%interlinearizer_phraseBox_unlink%',
  '%interlinearizer_phraseBox_splitHere%',
  '%interlinearizer_tokenChip_removeFromPhrase%',
  '%interlinearizer_glossInput_placeholder%',
  '%interlinearizer_continuousView_previousToken%',
  '%interlinearizer_continuousView_nextToken%',
] as const satisfies `%${string}%`[];

/** A between-group slot render item annotated with the absolute group indices on either side. */
type SlotUnit = {
  kind: 'slot';
  /** The slot's neighboring groups and any punctuation tokens in the gap. */
  slot: LinkSlot;
  /** Window-absolute index of the group before the slot, or `undefined` for the leading boundary. */
  prevGroupIndex: number | undefined;
  /** Window-absolute index of the group after the slot, or `undefined` for the trailing boundary. */
  nextGroupIndex: number | undefined;
};

/** A phrase-group render item annotated with its window-absolute group index. */
type GroupUnit = {
  kind: 'group';
  /** The phrase group to render. */
  group: TokenGroup;
  /** Absolute index of this group within the full `phraseGroups` array (not the window slice). */
  groupIndex: number;
};

/** Props for {@link ContinuousView}. */
type ContinuousViewProps = Readonly<{
  /** The full tokenized book whose tokens are streamed into the strip. */
  book: Book;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /**
   * Token ref of the currently focused word token, or `undefined` when nothing is focused. The
   * strip jumps to the group containing this token and uses it as the single source of truth for
   * highlight + slot rules. All scroll position is derived from this value.
   */
  focusedTokenRef: string | undefined;
  /**
   * Called when arrow navigation or a click in the strip should change which token is focused. The
   * parent echoes the value back through `focusedTokenRef`; the strip then re-renders with the new
   * focus and scrolls into view.
   */
  onFocusedTokenRefChange: (ref: string) => void;
  /** Current phrase-interaction mode; controls token click behavior in the strip. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token ref → segment id lookup; used to resolve the focused token's segment for slot rules. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → flat book-level index; used to sort phrase tokens in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Word token ref → token lookup; used to resolve the focused token from `focusedTokenRef`. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /** Bundled display toggles forwarded to the strip. */
  viewOptions: ViewOptions;
}>;

/**
 * Renders all tokens from every segment in the given book as a single flat, horizontally scrollable
 * strip. Word tokens belonging to the same phrase are joined into a single `PhraseBox`; arcs are
 * drawn between discontiguous boxes that share a phrase. Arrow buttons advance or retreat the view
 * by one phrase group at a time with smooth scrolling animation. No segment markers, verse labels,
 * or chapter boundaries are shown — the strip is fully continuous.
 *
 * Scroll position is derived from `focusedTokenRef`: the strip always centers the group containing
 * that token. Arrow buttons advance or retreat focus by one group and notify the parent; the parent
 * echoes the new ref back through `focusedTokenRef`. The previous/next arrows are disabled when the
 * first/last phrase is focused.
 */
export default function ContinuousView({
  book,
  editPhraseSegmentId,
  focusedTokenRef,
  onFocusedTokenRefChange,
  phraseMode,
  setPhraseMode,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
  viewOptions,
}: ContinuousViewProps) {
  const { hideInactiveLinkButtons, simplifyPhrases, showMorphology } = viewOptions;
  const isRtl = document.documentElement.dir === 'rtl';

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  /**
   * Verse-start token ref → verse label, over the whole book. Resolved exactly as the segment
   * list's labels are, so chapter qualification and the verse-start token resolution match. The
   * strip builder marks the slot that begins each verse with its label, and {@link PhraseSlot}
   * renders it below the link icon — this is what gives the continuous strip its inline verse
   * numbers.
   */
  const verseStartLabelByTokenRef = useMemo(
    () => buildVerseStartLabelsByTokenRef(book.segments),
    [book.segments],
  );

  const committedPhraseLinkByRef = usePhraseLinkMap();
  const committedPhraseLinkById = usePhraseLinkByIdMap();

  const editPhraseTokens = useEditPhraseTokens(phraseMode);

  /** Phrase groups built from the flat token list, respecting the committed phrase-link map. */
  const phraseGroups = useMemo(
    () => groupTokens(allTokens, committedPhraseLinkByRef),
    [allTokens, committedPhraseLinkByRef],
  );

  /** Maps each word token ref to the group index that contains it. */
  const groupIndexByTokenRef = useMemo(() => {
    const map = new Map<string, number>();
    phraseGroups.forEach((g, gi) => {
      g.tokens.forEach((t) => map.set(t.ref, gi));
    });
    return map;
  }, [phraseGroups]);

  /**
   * Token ref that the strip is currently displaying as focused. Lags `focusedTokenRef` during the
   * fade-out for external jumps so the window/scroll/highlight don't shift until the strip has
   * faded out. For internal nav (arrow buttons, phrase clicks) this is updated immediately so the
   * smooth scroll starts on the same frame.
   */
  const [displayFocusedTokenRef, setDisplayFocusedTokenRef] = useState<string | undefined>(
    focusedTokenRef,
  );

  /**
   * Group index of the displayed focused token, or `0` when nothing is focused. Single source of
   * truth for scroll position, windowing, arrow disabled state, and per-group focus highlighting.
   *
   * During a book change `displayFocusedTokenRef` lags the new book by one fade (it only catches up
   * when the fade timeout fires), so for a few frames it names a token from the previous book that
   * no longer exists in this book's `groupIndexByTokenRef`. Falling straight back to `0` then parks
   * the strip on the new book's very first phrase instead of the verse the user navigated to. Fall
   * back to the live `focusedTokenRef` first — the parent reseeds it to the new book's active verse
   * on the book change — so the transient lands on the intended verse rather than book start.
   */
  const focusPhraseIndex = useMemo(() => {
    const resolved =
      (displayFocusedTokenRef !== undefined
        ? groupIndexByTokenRef.get(displayFocusedTokenRef)
        : undefined) ??
      (focusedTokenRef !== undefined ? groupIndexByTokenRef.get(focusedTokenRef) : undefined);
    return resolved === undefined ? 0 : clampIndex(resolved, phraseGroups.length);
  }, [displayFocusedTokenRef, focusedTokenRef, groupIndexByTokenRef, phraseGroups.length]);

  const [isVisible, setIsVisible] = useState(false);

  /**
   * True for the single render in which an instant jump (external nav or initial mount) flips
   * {@link committedActiveSegmentId}, so the link slots snap to their new widths instead of
   * animating. `isVisible` alone can't gate this: the scroll effect's cleanup restores visibility
   * before the new effect commits the segment, so by the time the slots want their new widths
   * `isVisible` is already `true` and the transition would play — sliding the boxes (and yanking
   * the recentered phrase) for ~200ms after the fade-in. Cleared in the deferred fade-in frame, one
   * paint after the snap, so genuine in-view toggles still animate.
   */
  const [skipSlotTransitionForJump, setSkipSlotTransitionForJump] = useState(false);

  /** True until the first scroll-into-view completes; suppresses smooth scroll on initial mount. */
  const isInitialLoadInProgressRef = useRef(true);

  /**
   * Token ref that the strip set via `onFocusedTokenRefChange` from internal arrow nav or click.
   * When the parent echoes the same value back as `focusedTokenRef`, the focus-change effect
   * applies the new ref immediately and smooth-scrolls instead of fade-then-snap.
   */
  const internalFocusedTokenRefRef = useRef<string | undefined>(undefined);

  /** True when the last displayFocusedTokenRef update was triggered by internal navigation. */
  const lastDisplayUpdateWasInternalRef = useRef(false);

  /**
   * Tracks the "pending" phrase index for sequential arrow-button presses. Written synchronously by
   * `step()` so that a second click before re-render reads the already-advanced value instead of
   * the stale rendered `focusPhraseIndex`, preventing rapid double-clicks from advancing only one
   * group instead of two.
   */
  const pendingPhraseIndexRef = useRef(0);

  /**
   * `focusedTokenRef` prop value from the previous render. Lets the sync block below distinguish a
   * prop that merely hasn't echoed an in-flight internal nav yet (unchanged since last render) from
   * one the parent changed to an external position (changed to something other than the in-flight
   * ref).
   */
  const prevFocusedTokenRefPropRef = useRef(focusedTokenRef);
  // If the prop changed to anything other than the in-flight internal ref, the parent imposed an
  // external position instead of echoing the nav. Clear the in-flight marker so the pending index
  // resyncs below; otherwise the next step() would advance from the stale pending index rather
  // than the externally-imposed position. The focus-change effect can't cover this case: it
  // early-returns without clearing the marker when the external value already matches the
  // displayed ref.
  if (
    internalFocusedTokenRefRef.current !== undefined &&
    focusedTokenRef !== prevFocusedTokenRefPropRef.current &&
    focusedTokenRef !== internalFocusedTokenRefRef.current
  ) {
    internalFocusedTokenRefRef.current = undefined;
  }
  prevFocusedTokenRefPropRef.current = focusedTokenRef;
  // Keep in sync with the rendered value so external jumps reset the pending index. When an
  // internal nav is still in flight (the parent hasn't echoed back yet), do not overwrite: a rapid
  // second click needs to read the already-advanced pending index rather than the stale rendered
  // focusPhraseIndex.
  if (internalFocusedTokenRefRef.current === undefined) {
    pendingPhraseIndexRef.current = focusPhraseIndex;
  }

  /** DOM ref array indexed by group index; used to scroll the focused phrase box into view. */
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /** Ref-setter callbacks for {@link phraseRefs}, keyed by the group index each one writes. */
  const groupRefSetters = useRef(new Map<number, (el: HTMLSpanElement | null) => void>());

  /**
   * Book that {@link phraseRefs} and {@link groupRefSetters} hold entries for. Both are keyed by
   * absolute group index, which a different book reuses for different groups, and the component
   * instance survives a book change — so without dropping them here both would keep growing to the
   * largest book ever opened. Cleared during render rather than in an effect: refs for the new
   * book's groups are written during the commit that precedes the effect, and clearing afterward
   * would erase them.
   */
  const refsBookIdRef = useRef(book.id);
  if (refsBookIdRef.current !== book.id) {
    refsBookIdRef.current = book.id;
    phraseRefs.current = [];
    groupRefSetters.current.clear();
  }

  /**
   * Returns the callback that records a group's wrapper element under `groupIndex`. Each index
   * keeps one identity for as long as the strip shows this book, so handing the callback down
   * cannot invalidate a memoized child on a render that changed nothing else about it.
   *
   * One identity per index is safe only because React detaches refs in the mutation phase and
   * attaches them in the layout phase, for the whole commit rather than per element: a group moving
   * into an index another group has just vacated cannot write `null` over the newer element,
   * because every detach has already happened by the time any attach runs. Moving these writes into
   * a layout effect would give up that ordering guarantee.
   */
  const getGroupRefSetter = useCallback((groupIndex: number) => {
    const setters = groupRefSetters.current;
    let setter = setters.get(groupIndex);
    if (!setter) {
      setter = (el: HTMLSpanElement | null) => {
        phraseRefs.current[groupIndex] = el;
      };
      setters.set(groupIndex, setter);
    }
    return setter;
  }, []);

  /** Ref to the token-strip row; the content row and mouse-leave target. */
  // eslint-disable-next-line no-null/no-null
  const stripRowRef = useRef<HTMLDivElement | null>(null);

  /**
   * Scrolls the phrase group at `groupIndex` to horizontal center of the strip. Every centering
   * call site shares the `block: 'nearest', inline: 'center'` options and differs only in
   * `behavior`, so they route through here. Stable identity (reads `phraseRefs` and takes the index
   * explicitly) so the effects that center a snapshot index keep their intentionally-narrow dep
   * arrays.
   *
   * @param groupIndex - Index into `phraseRefs` of the group to center.
   * @param behavior - `'auto'` for an instant jump, `'smooth'` for an animated glide.
   */
  const centerGroup = useCallback((groupIndex: number, behavior: ScrollBehavior) => {
    phraseRefs.current[groupIndex]?.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  /**
   * Holds the group at `groupIndex` centered while the strip settles after an instant jump or the
   * committed-active-segment flip. Re-centers every animation frame — and, crucially, keeps holding
   * until the strip content has stopped reflowing rather than for a fixed clock: the window mounts
   * dozens of groups whose glosses, morpheme rows, and arcs finish laying out asynchronously over
   * many frames, and each such reflow of the content left of the focus shifts the focused box
   * sideways. A fixed {@link LINK_SLOT_TRANSITION_MS} hold expires before that settle completes,
   * leaving the focus (and its arcs) stranded off-center; observing the content row and
   * re-centering on each size change keeps the hold alive across a late reflow and re-centers once
   * it lands.
   *
   * The observer's lifetime is deliberately decoupled from the re-center loop's. The loop is a
   * quiet-period tick: it re-centers every frame, then stops once no reflow has fired for
   * {@link LINK_SLOT_TRANSITION_MS} (so it isn't spinning rAF forever while the strip is idle). But
   * the dominant reflow — the gloss-placeholder string resolving and the arc-settle passes widening
   * content to the left of the focus — routinely lands 300-500ms after mount, i.e. AFTER that quiet
   * window has already lapsed. If the observer were torn down when the loop stopped, that late
   * reflow would go unobserved and the focus would be stranded well off-center — an intermittent
   * "not centered on first load" failure. So the observer stays connected for the full
   * {@link HOLD_CENTERED_MAX_MS} window (a bound so a strip that never stabilizes can't hold the
   * observer forever), and any reflow within it restarts the tick loop to re-center.
   *
   * @returns A cancel function that stops the loop, the observer, and the hard-deadline timer; call
   *   it from the owning effect's cleanup.
   */
  const holdCentered = useCallback(
    (groupIndex: number) => {
      // Quiet deadline for the tick loop only; extended on each reflow. Seeded one quiet period out
      // so a reflow-free jump still holds briefly.
      let quietDeadline = performance.now() + LINK_SLOT_TRANSITION_MS;
      let rafId = 0;
      let stopped = false;
      const tick = () => {
        centerGroup(groupIndex, 'auto');
        if (performance.now() < quietDeadline) {
          rafId = requestAnimationFrame(tick);
        } else {
          // Idle: stop ticking but leave the observer connected so a late reflow can restart us.
          stopped = true;
        }
      };
      const observer = new ResizeObserver(() => {
        // A resize of the content row means the strip is still settling; push the quiet deadline out
        // and restart the loop if it had gone idle, so the re-center tracks the new layout instead of
        // leaving the focus stranded off-center.
        quietDeadline = performance.now() + LINK_SLOT_TRANSITION_MS;
        if (stopped) {
          stopped = false;
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(tick);
        }
      });
      const row = stripRowRef.current;
      if (row) observer.observe(row);
      rafId = requestAnimationFrame(tick);
      // Hard cap: disconnect the observer and stop ticking after the max hold, independent of the
      // quiet loop, so a never-settling strip can't hold resources forever.
      const hardStopTimer = setTimeout(() => {
        cancelAnimationFrame(rafId);
        observer.disconnect();
        stopped = true;
      }, HOLD_CENTERED_MAX_MS);
      return () => {
        clearTimeout(hardStopTimer);
        cancelAnimationFrame(rafId);
        observer.disconnect();
      };
    },
    [centerGroup],
  );

  /**
   * Ref to the fixed-width clipping viewport that wraps the content row. Because the inner row is
   * `w-max` (sized to its content), this outer element is the one that actually scrolls when
   * `scrollIntoView` centers a phrase, so its `scrollend` event is what signals the animation has
   * settled.
   */
  // eslint-disable-next-line no-null/no-null
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  /**
   * Segment id whose link buttons are currently treated as active, lagging `focusedTokenRef` during
   * internal navigation. Toggling this adds/removes inactive link icons, which re-lays out the
   * whole strip; deferring it until the smooth scroll settles keeps the animation a pure one-token
   * glide with no mid-flight box shifts. For external jumps and the initial mount it tracks the
   * focus immediately (the strip is faded out or static, so there is no animation to disturb).
   */
  const [committedActiveSegmentId, setCommittedActiveSegmentId] = useState<string | undefined>(
    () => (focusedTokenRef !== undefined ? tokenSegmentMap.get(focusedTokenRef) : undefined),
  );

  /**
   * The active segment the focus currently implies, recomputed every render. The lagging
   * {@link committedActiveSegmentId} is reconciled toward this value either immediately (external
   * jumps) or after the scroll animation (internal nav).
   */
  const targetActiveSegmentId =
    focusedTokenRef !== undefined ? tokenSegmentMap.get(focusedTokenRef) : undefined;

  /** Ref mirror of the target so the post-scroll timeout reads the latest value without a dep. */
  const targetActiveSegmentIdRef = useLatestRef(targetActiveSegmentId);

  /** Snaps the committed active segment to the current target; runs after an internal-nav scroll. */
  const commitPendingActiveSegment = useCallback(() => {
    setCommittedActiveSegmentId(targetActiveSegmentIdRef.current);
  }, [targetActiveSegmentIdRef]);

  /**
   * `focusedTokenRef` last seen by the segmentation-reconcile effect below, so it can distinguish
   * "the focused token's segment id changed because the segmentation changed" (commit immediately)
   * from "focus moved" (the focus-change machinery owns the commit timing).
   */
  const prevFocusForSegmentationRef = useRef(focusedTokenRef);

  /**
   * `true` while an internal-nav smooth scroll is animating and its deferred active-segment commit
   * is still pending on `scrollend` (or the fallback timeout). The segmentation-reconcile effect
   * reads this to avoid committing early mid-glide — the pending `onSettled` commits against the
   * live `targetActiveSegmentIdRef`, which already reflects the re-segmentation, so the correct
   * segment lands once the scroll finishes instead of snapping the glide short.
   */
  const scrollSettlePendingRef = useRef(false);

  // Reconcile the committed active segment when a segmentation edit (merge/split) changes the
  // focused token's segment id without moving focus. Token refs survive re-segmentation, so no
  // focus-change effect fires for such an edit; without this the committed id would keep naming a
  // segment that no longer exists, deactivating every link button until the next navigation. Only
  // fires while focus is unchanged — a focus move commits through its own paths (deferred to the
  // scroll settle for internal nav, behind the fade for external jumps), which this must not
  // preempt. A real commit also flips the active-segment recenter effect below, re-pinning the
  // focused group against the edit's relayout.
  useEffect(() => {
    const focusUnchanged = prevFocusForSegmentationRef.current === focusedTokenRef;
    prevFocusForSegmentationRef.current = focusedTokenRef;
    if (!focusUnchanged) return;
    // Defer to the in-flight scroll's `onSettled` when an internal-nav glide is still animating:
    // committing here would flip `committedActiveSegmentId` and fire the instant recenter below,
    // truncating the smooth scroll into a jump. `onSettled` commits the same (already-updated)
    // target once the glide finishes, so the reconcile still happens — just without the snap.
    if (scrollSettlePendingRef.current) return;
    commitPendingActiveSegment();
  }, [tokenSegmentMap, focusedTokenRef, commitPendingActiveSegment]);

  /** Ref mirror of `onFocusedTokenRefChange` so callbacks never need it as a dep. */
  const onFocusedTokenRefChangeRef = useLatestRef(onFocusedTokenRefChange);

  /**
   * Emits a focus change that originated _inside_ the strip (arrow nav, phrase click, edit-mode
   * jump). Records the ref as internally-originated, then notifies the parent. When the parent
   * echoes the same ref back through `focusedTokenRef`, the focus-change effect recognizes the
   * match and applies it immediately with a smooth scroll instead of the fade-then-snap used for
   * external jumps. Folds the stamp and the notify into one call so the "this is an internal emit"
   * intent lives in a single place rather than being restated at each call site.
   */
  const emitInternalFocus = useCallback(
    (ref: string) => {
      internalFocusedTokenRefRef.current = ref;
      onFocusedTokenRefChangeRef.current(ref);
    },
    [onFocusedTokenRefChangeRef],
  );

  // Notify the parent of the initially-focused token on mount so the segment list scrolls the
  // active verse into view on first render. Only fires when no token was already focused.
  useEffect(() => {
    if (focusedTokenRef !== undefined) return;
    const initialGroup = phraseGroups[focusPhraseIndex];
    const initialRef = initialGroup?.tokens[0]?.ref;
    if (initialRef !== undefined) onFocusedTokenRefChangeRef.current(initialRef);
    // Intentionally runs only on mount; do not add deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atStart = phraseGroups.length === 0 || focusPhraseIndex === 0;
  const atEnd = phraseGroups.length === 0 || focusPhraseIndex >= phraseGroups.length - 1;
  const stripOpacityClass = isVisible ? 'tw:opacity-100' : 'tw:opacity-0';

  /** Phrase groups mounted on each side of the focus, sized to the strip's visible width. */
  const phraseWindowHalf = usePhraseWindowHalf(
    scrollViewportRef,
    stripRowRef,
    () => phraseRefs.current[focusPhraseIndex] ?? undefined,
  );

  /**
   * First and last group index of each phrase, so the window can mount every fragment of a phrase
   * it touches. Only a discontiguous phrase spans more than one group.
   */
  const groupSpanByPhraseId = useMemo(() => {
    const spans = new Map<string, { first: number; last: number }>();
    phraseGroups.forEach((group, index) => {
      const phraseId = group.phraseLink?.analysisId;
      if (phraseId === undefined) return;
      const span = spans.get(phraseId);
      if (span) span.last = index;
      else spans.set(phraseId, { first: index, last: index });
    });
    return spans;
  }, [phraseGroups]);

  /**
   * The inclusive group-index bounds of the rendered window, widened to cover every fragment of any
   * phrase it touches. An arc is drawn between two mounted phrase boxes, so a phrase with one
   * fragment left outside loses its arc altogether — including the leg that would have crossed the
   * viewport — leaving the visible fragment with no phrase cue.
   */
  const [renderWindowStart, renderWindowEnd] = useMemo(() => {
    let start = Math.max(0, focusPhraseIndex - phraseWindowHalf);
    let end = Math.min(phraseGroups.length - 1, focusPhraseIndex + phraseWindowHalf);
    // Re-scanning after a widening catches a phrase pulled in by the previous one. The bounds only
    // ever widen, so the loop terminates, and every token of a phrase comes from one segment, so it
    // cannot run away.
    let widened = true;
    while (widened) {
      widened = false;
      for (let index = start; index <= end; index += 1) {
        const phraseId = phraseGroups[index].phraseLink?.analysisId;
        const span = phraseId === undefined ? undefined : groupSpanByPhraseId.get(phraseId);
        if (span !== undefined && (span.first < start || span.last > end)) {
          start = Math.min(start, span.first);
          end = Math.max(end, span.last);
          widened = true;
        }
      }
    }
    return [start, end];
  }, [focusPhraseIndex, phraseWindowHalf, phraseGroups, groupSpanByPhraseId]);

  /**
   * The groups in the rendered window. Memoized on the bounds (and the source groups) so the array
   * identity is stable while the window is unchanged. This matters because these groups feed the
   * arc-measurement pass's dependency list: a fresh `.slice()` every render would bump its internal
   * version counter every render, forcing a re-measure on each pass and defeating its own
   * loop-damping (which keys off whether a real input changed).
   */
  const renderWindowGroups = useMemo(
    () => phraseGroups.slice(renderWindowStart, renderWindowEnd + 1),
    [phraseGroups, renderWindowStart, renderWindowEnd],
  );

  /**
   * The flat token-index range spanned by the mounted render-window groups, used to slice
   * `allTokens` for rendering punctuation tokens that appear between phrase groups.
   */
  const renderWindowStartTokenIndex =
    phraseGroups.length > 0 && renderWindowStart > 0
      ? phraseGroups[renderWindowStart].firstIndex
      : 0;
  const renderWindowEndTokenIndex =
    phraseGroups.length > 0 && renderWindowEnd < phraseGroups.length - 1
      ? phraseGroups[renderWindowEnd + 1].firstIndex
      : allTokens.length;

  /**
   * Advances focus by `delta` phrases by notifying the parent of the new focused token ref. The
   * parent echoes the change back through `focusedTokenRef`, which re-derives `focusPhraseIndex`
   * and triggers the scroll effect. Marks the change as internal so the fade is suppressed.
   *
   * @param delta - Number of phrases to move (positive = forward, negative = backward).
   */
  const step = useCallback(
    (delta: number) => {
      /* v8 ignore next -- arrow buttons are disabled when phraseGroups is empty */
      if (phraseGroups.length === 0) return;
      const nextIndex = pendingPhraseIndexRef.current + delta;
      /* v8 ignore next -- disabled buttons prevent under/overflow */
      const clamped = nextIndex < 0 ? 0 : Math.min(nextIndex, phraseGroups.length - 1);
      /* v8 ignore next -- disabled buttons prevent clicking when already at boundary */
      if (clamped === pendingPhraseIndexRef.current) return;
      pendingPhraseIndexRef.current = clamped;
      const nextRef = phraseGroups[clamped]?.tokens[0]?.ref;
      if (nextRef !== undefined) emitInternalFocus(nextRef);
    },
    [phraseGroups, emitInternalFocus],
  );

  /** Moves focus one phrase backward. */
  const stepPrev = useCallback(() => step(-1), [step]);

  /** Moves focus one phrase forward. */
  const stepNext = useCallback(() => step(1), [step]);

  /** Ref mirror of the focus so the select handler can compare against it without a dep on it. */
  const focusedTokenRefRef = useLatestRef(focusedTokenRef);

  /**
   * Notifies the parent that the user selected the phrase whose first token is `ref`. The parent
   * echoes the new token ref back through `focusedTokenRef`; scroll + highlight follow
   * automatically. Selecting the already-focused phrase is a no-op.
   *
   * Reads the current focus through a ref rather than closing over it, so the handler keeps one
   * identity across focus moves and passing it down cannot invalidate a memoized child.
   *
   * @param ref - First-token ref (group key) of the selected phrase.
   */
  const handlePhraseSelect = useCallback(
    (ref: string) => {
      const targetGroupIndex = groupIndexByTokenRef.get(ref);
      const currentFocus = focusedTokenRefRef.current;
      const currentGroupIndex =
        currentFocus === undefined ? undefined : groupIndexByTokenRef.get(currentFocus);
      if (targetGroupIndex !== undefined && targetGroupIndex === currentGroupIndex) return;
      emitInternalFocus(ref);
    },
    [focusedTokenRefRef, groupIndexByTokenRef, emitInternalFocus],
  );

  /** Splits a phrase arc at a token boundary and dispatches the resulting phrase-store writes. */
  const handleArcSplit = useArcSplitHandler(tokenDocOrder);

  // React to changes in the prop `focusedTokenRef`. For internal nav (arrow/click in this view),
  // apply the change immediately and smooth-scroll. For external jumps (segment-mode click,
  // Paratext verse selector, mode switch), fade the strip out, wait for the fade to complete,
  // then snap the displayed focus into place so the scroll happens behind the curtain.
  useEffect(() => {
    if (focusedTokenRef === displayFocusedTokenRef) return undefined;
    const isInternal = internalFocusedTokenRefRef.current === focusedTokenRef;
    internalFocusedTokenRefRef.current = undefined;
    if (isInternal) {
      lastDisplayUpdateWasInternalRef.current = true;
      setDisplayFocusedTokenRef(focusedTokenRef);
      return undefined;
    }
    lastDisplayUpdateWasInternalRef.current = false;
    setIsVisible(false);
    const timeout = setTimeout(() => {
      setDisplayFocusedTokenRef(focusedTokenRef);
    }, RECENTER_FADE_MS);
    return () => clearTimeout(timeout);
  }, [focusedTokenRef, displayFocusedTokenRef]);

  // Scroll the focused phrase into view whenever the displayed focus changes. Smooth-scroll for
  // internal nav (the displayed ref was updated immediately, so the prop and display agree); snap
  // for external jumps (the displayed ref was just updated post-fade) and for the initial mount.
  useEffect(() => {
    const isInternal = lastDisplayUpdateWasInternalRef.current;
    lastDisplayUpdateWasInternalRef.current = false;
    const isInitialLoad = isInitialLoadInProgressRef.current;
    const shouldJumpInstantly = !isInternal || isInitialLoad;

    if (shouldJumpInstantly) {
      // External jumps fade the strip out and the initial mount is static, so there is no animation
      // to disturb — commit the active segment now alongside the instant scroll.
      setSkipSlotTransitionForJump(true);
      commitPendingActiveSegment();
      centerGroup(focusPhraseIndex, 'auto');
    }

    if (isInternal && !isInitialLoad) {
      // Defer the smooth scroll one frame so the window re-render (groups mounting/unmounting as the
      // window slides) has settled into its final layout before the animation computes its target.
      // Scrolling synchronously here animates toward a position that then shifts, producing a visible
      // overshoot-and-return ("yank") when crossing a verse boundary.
      const navRafId = requestAnimationFrame(() => {
        centerGroup(focusPhraseIndex, 'smooth');
      });
      // Commit the active-segment change (which toggles inactive link-icon visibility, re-laying out
      // the strip) only once the smooth scroll has actually settled. Updating it mid-scroll would
      // add/remove icons while the strip is moving, shifting every box and turning the smooth glide
      // into a jump-and-settle.
      //
      // Prefer the browser's `scrollend` event so the relayout lands the instant the animation
      // finishes — adaptive to hardware, no guessed duration. `scrollend` is not universal and never
      // fires when the target was already centered (no scroll happens), so a timeout backstops both
      // cases. Whichever fires first wins; the other is torn down.
      // `scrollIntoView` scrolls the nearest scrollable ancestor. Depending on layout that can be
      // either the fixed-width clipping viewport or the content row, so listen on both — whichever
      // actually scrolls fires `scrollend`. Commit on the first signal, then tear everything down so
      // the relayout runs exactly once.
      const scrollers = [scrollViewportRef.current, stripRowRef.current];
      let fallbackTimeout: ReturnType<typeof setTimeout>;
      // Mark the settle pending so the segmentation-reconcile effect defers its commit to `onSettled`
      // instead of snapping the glide short if a boundary edit lands mid-scroll.
      scrollSettlePendingRef.current = true;
      /** Commits the pending active segment and tears down both the timeout and scroll listeners. */
      const onSettled = () => {
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
        scrollSettlePendingRef.current = false;
        commitPendingActiveSegment();
      };
      fallbackTimeout = setTimeout(onSettled, SCROLL_SETTLE_FALLBACK_MS);
      scrollers.forEach((el) => el?.addEventListener('scrollend', onSettled, { once: true }));
      return () => {
        cancelAnimationFrame(navRafId);
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
        scrollSettlePendingRef.current = false;
      };
    }

    if (isInitialLoad) isInitialLoadInProgressRef.current = false;

    // Defer the fade-in until after the browser applies the instant scroll position.
    const rafId = requestAnimationFrame(() => {
      setIsVisible(true);
      // The snapped-slot paint has happened; re-enable the transition for later in-view toggles.
      setSkipSlotTransitionForJump(false);
    });
    // Hold the group centered through the reveal. The window slide mounts/unmounts groups whose
    // arcs and morpheme rows finish laying out asynchronously over the next frames, shifting the
    // strip after the instant snap above. The committed-active-segment layout effect re-centers
    // against that drift, but only when the segment id actually flips — a jump landing in the
    // already-active segment (a token click in the active verse) gets no correction there and was
    // revealed off-center. Hold on the shared clock so every instant jump stays pinned regardless
    // of whether the active segment changed.
    const cancelHold = holdCentered(focusPhraseIndex);
    return () => {
      cancelAnimationFrame(rafId);
      cancelHold();
      setIsVisible(true);
    };
  }, [focusPhraseIndex, commitPendingActiveSegment, centerGroup, holdCentered]);

  // Keep the focused group pinned dead-center after the deferred active-segment flip. When
  // `committedActiveSegmentId` flips (after an internal-nav scroll settles), inactive link icons
  // fade in/out over `LINK_SLOT_TRANSITION_MS`. Because they are hidden via `opacity: 0` their
  // layout space is preserved, so boxes do not shift — but any residual sub-pixel drift from the
  // preceding smooth scroll is corrected by re-centering once before paint. The shared hold loop
  // keeps the group centered for the full fade duration as a conservative guard against any future
  // layout changes that could re-introduce drift. The first run is skipped because the initial
  // center is established by the scroll effect's instant jump. A `useLayoutEffect` seeds the loop
  // with a synchronous re-center so the very first correction lands before paint (no initial
  // flash), then the hold's `rAF` carries it through the fade.
  const skipActiveSegmentRecenterRef = useRef(true);
  useLayoutEffect(() => {
    if (skipActiveSegmentRecenterRef.current) {
      skipActiveSegmentRecenterRef.current = false;
      return undefined;
    }
    centerGroup(focusPhraseIndex, 'auto');
    return holdCentered(focusPhraseIndex);
    // Only the active-segment flip should trigger this re-anchor; focusPhraseIndex has its own scroll
    // effect. Reading it here is a snapshot, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedActiveSegmentId]);

  // Re-center the focused group when a view option toggles. Toggling `simplifyPhrases` or
  // `showMorphology` changes the strip's layout (morpheme rows can widen phrase boxes), so the
  // previously-centered group may drift off-center; snap it back into view.
  // `hideInactiveLinkButtons` is excluded: inactive link slots reserve their space even when
  // hidden (`opacity: 0`; clickability is guarded at the button level), so toggling it does not
  // shift the layout.
  useEffect(() => {
    centerGroup(focusPhraseIndex, 'auto');
    // focusPhraseIndex is intentionally excluded: it has its own scroll effect above. This effect
    // only re-centers in response to layout-affecting option toggles. centerGroup is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simplifyPhrases, showMorphology]);

  // Re-center the focused group when the render window changes size. A wider window mounts groups
  // *ahead* of the focus as well as behind it at an unchanged scroll offset, sliding the focused
  // group sideways by their combined width — on a panel drag, far enough to carry the phrase the
  // reader is working on off the strip. The focus itself has not moved, so no focus-keyed centering
  // path fires, and the browser does not absorb it either: scroll anchoring adjusts the block axis
  // only, and this strip scrolls on the inline axis. A layout effect, so the correction is in place
  // before the shifted frame is painted rather than showing as a jump. The correction then holds:
  // the groups the window just mounted finish laying out their glosses, morpheme rows, and arcs
  // over the following frames, and every such reflow left of the focus shifts it again. A resize
  // happens while the strip is otherwise idle, so no other hold is alive to absorb that late shift.
  useLayoutEffect(() => {
    centerGroup(focusPhraseIndex, 'auto');
    return holdCentered(focusPhraseIndex);
    // focusPhraseIndex is intentionally excluded: it has its own scroll effect above. centerGroup
    // and holdCentered are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseWindowHalf]);

  // When entering edit or confirm-unlink mode, smooth-scroll to the first group of the active
  // phrase by notifying the parent of the new focused token. Scroll then follows automatically
  // through focusedTokenRef → focusPhraseIndex.
  useEffect(() => {
    if (phraseMode.kind === 'view') return;
    const targetPhraseId = phraseMode.phraseId;
    const group = phraseGroups.find((g) => g.phraseLink?.analysisId === targetPhraseId);
    const nextRef = group?.tokens[0]?.ref;
    /* v8 ignore next -- phrase always has tokens; focusedTokenRef differs at mode entry */
    if (nextRef === undefined || nextRef === focusedTokenRef) return;
    emitInternalFocus(nextRef);
    // phraseGroups and focusedTokenRef are read once per mode change; intentionally not deps so the
    // effect only fires on actual mode transitions. emitInternalFocus has a stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseMode]);

  /**
   * Ref to the outer `tw:relative tw:overflow-visible` strip-fade-wrapper div that is both the SVG
   * parent and the arc measurement container. Using this element (rather than the inner token-strip
   * div) aligns the coordinate origin with the SVG's `inset: 0` anchor, so arc y-positions match.
   */
  // eslint-disable-next-line no-null/no-null
  const arcContainerRef = useRef<HTMLDivElement | null>(null);

  /** The phraseId whose arc is currently highlighted due to a phrase box being hovered. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  /**
   * Hover-preview state shared with SegmentView: the hovered group key (keyed by ref to match
   * SegmentView), link-candidate token refs, and would-become-free token refs, plus their stable
   * handlers.
   */
  const {
    hoveredGroupKey,
    setHoveredGroupKey,
    candidateTokenRefs,
    setCandidateTokenRefs,
    splitFreeTokenRefs,
    handleSplitHoverChange,
    handleHoverSplitFreeTokens,
    clearAll: clearHoverState,
  } = usePhraseHoverState();

  /** Clears both the hovered phrase id and all hover-preview state on mouse leave. */
  const clearAllHoverState = useCallback(() => {
    setHoveredPhraseId(undefined);
    clearHoverState();
  }, [clearHoverState]);

  const candidatePhraseIds = useCandidatePhraseIds(candidateTokenRefs, committedPhraseLinkByRef);

  /**
   * Strip-wide context value for this render. `setHoveredPhraseId` doubles as both the phrase-hover
   * and candidate-phrase hover callback. The active segment lags the focus
   * (`committedActiveSegmentId`); the link-slot transition is suppressed while the strip is faded
   * out or snapping into place after an instant jump.
   */
  const stripContext = usePhraseStripContextValue({
    phraseMode,
    setPhraseMode,
    editPhraseTokens,
    editPhraseSegmentId,
    tokenSegmentMap,
    tokenDocOrder,
    onHoverPhrase: setHoveredPhraseId,
    onHoverCandidateTokens: setCandidateTokenRefs,
    onHoverSplitFreeTokens: handleHoverSplitFreeTokens,
    hideInactiveLinkButtons,
    simplifyPhrases,
    activeSegmentId: committedActiveSegmentId,
    crossSegmentLinkTooltip:
      localizedStrings['%interlinearizer_linkButton_crossSegmentDisabledTooltip%'],
    linkTokensLabel: localizedStrings['%interlinearizer_linkButton_link%'],
    unlinkTokensLabel: localizedStrings['%interlinearizer_linkButton_unlink%'],
    boundaryMergeLabel: localizedStrings['%interlinearizer_boundaryControl_merge%'],
    boundaryMergeAltHint: localizedStrings['%interlinearizer_boundaryControl_mergeAltHint%'],
    boundarySplitLabel: localizedStrings['%interlinearizer_boundaryControl_split%'],
    phraseGlossLabel: localizedStrings['%interlinearizer_phraseBox_glossLabel%'],
    phraseEditLabel: localizedStrings['%interlinearizer_phraseBox_edit%'],
    phraseUnlinkLabel: localizedStrings['%interlinearizer_phraseBox_unlink%'],
    removeTokenFromPhraseTemplate: localizedStrings['%interlinearizer_tokenChip_removeFromPhrase%'],
    glossPlaceholder: resolvedOrEmpty(localizedStrings['%interlinearizer_glossInput_placeholder%']),
    skipLinkTransition: !isVisible || skipSlotTransitionForJump,
    showMorphology,
  });

  /**
   * Group index of the focused token, derived from `focusedTokenRef`. Used per-slot to compute
   * `focusedSideIsPrev` from the same source as `focus.focusedPhraseLink` /
   * `focus.focusedFreeToken` so link direction and link target can never disagree.
   */
  const focusedGroupIndex = useMemo(
    () => (focusedTokenRef !== undefined ? groupIndexByTokenRef.get(focusedTokenRef) : undefined),
    [focusedTokenRef, groupIndexByTokenRef],
  );

  /**
   * Resolved focus context — what's focused, what segment it's in, what phrase it belongs to. Built
   * from the fade-gated `displayFocusedTokenRef` (not the live `focusedTokenRef`) so every
   * highlight and link-button active/disabled decision moves only at the recenter midpoint, behind
   * the fade — never re-evaluating (and dimming the buttons) on the still-visible old strip the
   * instant an external nav reseeds the live focus. The scroll target (`focusedGroupIndex`) still
   * uses the live ref so the jump lands on the new verse behind the curtain. Mirrors SegmentView,
   * which is fed the segment window's own gated display ref.
   */
  const focus = useMemo(
    () =>
      resolveFocusContext(
        displayFocusedTokenRef,
        wordTokenByRef,
        committedPhraseLinkByRef,
        tokenSegmentMap,
      ),
    [displayFocusedTokenRef, wordTokenByRef, committedPhraseLinkByRef, tokenSegmentMap],
  );

  /** True when any committed phrase exists in the visible window. */
  const hasRealPhraseInRenderWindow = renderWindowGroups.some((g) => g.phraseLink !== undefined);

  // Measure phrase boxes after each render and compute arcs for discontiguous phrases.
  const { arcPaths, stripTopPadding, stripLeftPadding, stripRightPadding } = useArcPaths(
    arcContainerRef,
    true,
    hasRealPhraseInRenderWindow,
    [renderWindowGroups, phraseMode, committedActiveSegmentId],
  );

  /**
   * Interleaved render units (groups + link slots) in document order across the window — built by
   * the one shared interleaving, so no two layouts can order tokens and slots differently. Each
   * group unit is then annotated with its absolute group index.
   */
  const renderItems = useMemo(() => {
    const renderWindowTokens = allTokens.slice(
      renderWindowStartTokenIndex,
      renderWindowEndTokenIndex,
    );
    const rawUnits = buildRenderUnits(renderWindowTokens, renderWindowGroups);
    const groupIndexOffset = renderWindowStart;
    const groupIndexByGroup = new Map(renderWindowGroups.map((g, i) => [g, i + groupIndexOffset]));
    const result: (SlotUnit | GroupUnit)[] = [];
    rawUnits.forEach((unit) => {
      if (unit.kind === 'slot') {
        result.push({
          kind: 'slot',
          slot: unit.slot,
          prevGroupIndex: unit.slot.prevGroup
            ? groupIndexByGroup.get(unit.slot.prevGroup)
            : undefined,
          nextGroupIndex: unit.slot.nextGroup
            ? groupIndexByGroup.get(unit.slot.nextGroup)
            : undefined,
        });
      } else {
        const groupIndex =
          /* v8 ignore next -- all window groups are always indexed; fallback is a defensive guard */
          groupIndexByGroup.get(unit.group) ??
          renderWindowGroups.indexOf(unit.group) + groupIndexOffset;
        result.push({ kind: 'group', group: unit.group, groupIndex });
      }
    });
    return result;
  }, [
    allTokens,
    renderWindowGroups,
    renderWindowStartTokenIndex,
    renderWindowEndTokenIndex,
    renderWindowStart,
  ]);

  /**
   * Per-slot `focusedSideIsPrev`, precomputed once from the focused token's absolute group index. A
   * slot's value is `true` when the focused group is start-ward of the slot, `false` when end-ward,
   * and `undefined` when nothing is focused or the slot is a leading/trailing boundary. Keyed by
   * slot item so the render body can look it up instead of computing the comparison inline.
   */
  const focusedSideIsPrevByItem = useMemo(() => {
    const map = new Map<SlotUnit, boolean | undefined>();
    renderItems.forEach((item) => {
      if (item.kind !== 'slot') return;
      map.set(
        item,
        focusedGroupIndex !== undefined &&
          item.prevGroupIndex !== undefined &&
          item.nextGroupIndex !== undefined
          ? focusedGroupIndex <= item.prevGroupIndex
          : undefined,
      );
    });
    return map;
  }, [renderItems, focusedGroupIndex]);

  /**
   * Normalized strip items handed to the shared {@link PhraseStrip} body. Each slot's segment ids
   * are resolved from the absolute group indices, and each group carries the scroll-into-view ref
   * by its absolute group index.
   */
  const stripItems = useMemo<StripItem[]>(
    () =>
      renderItems.map((item) => {
        if (item.kind === 'slot') {
          const { prevGroup, nextGroup } = item.slot;
          const key = `slot-${prevGroup?.tokens[prevGroup.tokens.length - 1]?.ref ?? 'start'}-${nextGroup?.tokens[0]?.ref ?? 'end'}`;
          const prevSegmentId =
            item.prevGroupIndex !== undefined && phraseGroups[item.prevGroupIndex] !== undefined
              ? tokenSegmentMap.get(phraseGroups[item.prevGroupIndex].tokens[0].ref)
              : undefined;
          const nextSegmentId =
            item.nextGroupIndex !== undefined && phraseGroups[item.nextGroupIndex] !== undefined
              ? tokenSegmentMap.get(phraseGroups[item.nextGroupIndex].tokens[0].ref)
              : undefined;
          return {
            kind: 'slot',
            key,
            slot: item.slot,
            prevSegmentId,
            nextSegmentId,
            focusedSideIsPrev: focusedSideIsPrevByItem.get(item),
            verseLabel: slotVerseLabel(item.slot, verseStartLabelByTokenRef),
          };
        }
        const { group, groupIndex } = item;
        return {
          kind: 'group',
          key: group.tokens[0].ref,
          group,
          isFocused: group.tokens.some((t) => t.ref === displayFocusedTokenRef),
          groupRef: getGroupRefSetter(groupIndex),
        };
      }),
    [
      renderItems,
      phraseGroups,
      tokenSegmentMap,
      focusedSideIsPrevByItem,
      displayFocusedTokenRef,
      verseStartLabelByTokenRef,
      getGroupRefSetter,
    ],
  );

  return (
    <div className="tw:relative tw:flex tw:items-center tw:gap-1">
      {/* Previous navigation arrow */}
      <Button
        aria-label={localizedStrings['%interlinearizer_continuousView_previousToken%']}
        disabled={atStart}
        onClick={stepPrev}
        size="icon-sm"
        tabIndex={-1}
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true">{isRtl ? '\u2192' : '\u2190'}</span>
      </Button>

      {/* Scrollable token strip */}
      <div
        data-testid="strip-scroll-viewport"
        ref={scrollViewportRef}
        className="tw:relative tw:flex-1"
        // Hidden on both axes rather than clipped: the element has to stay a scroll container for
        // `scrollIntoView` to center a phrase in it, which `overflow: clip` would give up. The
        // block axis cannot be `visible` either — CSS computes a lone `visible` to `auto` when the
        // other axis is neither `visible` nor `clip`, which would let a scrollbar appear and shrink
        // the width the render-window measurement reads.
        style={{ overflowX: 'hidden', overflowY: 'hidden' }}
      >
        {/* Previous fade overlay — only rendered when the previous arrow is enabled */}
        {!atStart && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:inset-s-0 tw:z-10 tw:w-8 tw:bg-linear-to-e tw:from-background tw:to-transparent"
          />
        )}

        {/* Next fade overlay — only rendered when the next arrow is enabled */}
        {!atEnd && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:inset-e-0 tw:z-10 tw:w-8 tw:bg-linear-to-s tw:from-background tw:to-transparent"
          />
        )}

        {/* Inner flex row: both the arc SVG and the token strip fade together */}
        <div
          data-testid="strip-fade-wrapper"
          ref={arcContainerRef}
          className={`tw:arc-container tw:transition-opacity ${stripOpacityClass}`}
          style={RECENTER_FADE_TRANSITION_STYLE}
        >
          <MemoizedArcOverlay
            arcPaths={arcPaths}
            phraseMode={phraseMode}
            hoveredPhraseId={hoveredPhraseId}
            focusedPhraseId={focus.focusedPhraseId}
            candidatePhraseIds={candidatePhraseIds}
            phraseLinkById={committedPhraseLinkById}
            tokenDocOrder={tokenDocOrder}
            splitHereLabel={localizedStrings['%interlinearizer_phraseBox_splitHere%']}
            onArcSplit={handleArcSplit}
            onSplitHoverChange={handleSplitHoverChange}
            onHoverPhrase={setHoveredPhraseId}
            simplifyPhrases={simplifyPhrases}
          />
          <PhraseStripProvider value={stripContext}>
            <div
              data-testid="token-strip"
              className="tw:no-scrollbar tw:pointer-events-none tw:relative tw:z-60 tw:flex tw:w-max tw:items-start tw:gap-1 tw:overflow-x-scroll tw:pb-2"
              ref={stripRowRef}
              style={{
                paddingTop: `${stripTopPadding}px`,
                paddingLeft: `${stripLeftPadding}px`,
                paddingRight: `${stripRightPadding}px`,
              }}
              onMouseLeave={clearAllHoverState}
            >
              <PhraseStrip
                items={stripItems}
                phraseMode={phraseMode}
                focus={focus}
                hoveredPhraseId={hoveredPhraseId}
                hoveredGroupKey={hoveredGroupKey}
                candidateTokenRefs={candidateTokenRefs}
                splitFreeTokenRefs={splitFreeTokenRefs}
                onHoverPhrase={setHoveredPhraseId}
                setHoveredGroupKey={setHoveredGroupKey}
                onFocusPhrase={handlePhraseSelect}
              />
            </div>
          </PhraseStripProvider>
        </div>
      </div>

      {/* Next navigation arrow */}
      <Button
        aria-label={localizedStrings['%interlinearizer_continuousView_nextToken%']}
        disabled={atEnd}
        onClick={stepNext}
        size="icon-sm"
        tabIndex={-1}
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true">{isRtl ? '\u2190' : '\u2192'}</span>
      </Button>
    </div>
  );
}
