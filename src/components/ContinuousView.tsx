import { useLocalizedStrings } from '@papi/frontend/react';
import type { Book, Token } from 'interlinearizer';
import { LocateFixed } from 'lucide-react';
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
import usePhraseWindow from '../hooks/usePhraseWindow';
import MemoizedArcOverlay from './ArcOverlay';
import { useFocus, useFocusActions, useFocusGetter } from './FocusStore';
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
export const HOLD_CENTERED_MAX_MS = 2_000;

/**
 * Pixels a line-mode wheel delta stands for. Firefox and some Linux configurations report travel in
 * lines rather than pixels, which taken at face value would barely move the strip. Approximates a
 * line of the strip's text closely enough that a notch travels about as far in either mode.
 */
const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * How far the strip travels per pixel of wheel travel. Below 1:1 on purpose: the strip is a single
 * line of text, so a gesture a full page absorbs unremarkably would sweep several viewports of
 * phrases past the reader — fast enough that nothing on it can be read. Sized so an ordinary swipe
 * moves the strip by a fraction of its width rather than a multiple of it.
 */
export const WHEEL_SCROLL_GAIN = 0.35;

/**
 * Furthest the strip travels on any one wheel event. A compositor coalesces events it could not
 * deliver, so a single one carries whatever accumulated — thousands of pixels on some trackpads,
 * and often arriving after the fingers have already stopped. A ceiling bounds what any one event
 * can do without bounding a sustained gesture, which keeps delivering events while the fingers
 * move.
 */
export const MAX_WHEEL_TRAVEL_PX = 60;

/**
 * Pixels one unit of a wheel delta stands for, given the mode the event reports it in and the
 * viewport a page-mode delta is measured against.
 *
 * @returns `1` for a pixel-mode delta, so an unrecognized mode is read at face value rather than
 *   scaled by a guess.
 */
function wheelDeltaScale(deltaMode: number, viewport: HTMLElement | null): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return WHEEL_LINE_HEIGHT_PX;
  /* v8 ignore next -- the viewport is attached whenever a wheel reaches this handler */
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return viewport?.clientWidth ?? 0;
  return 1;
}

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
  '%interlinearizer_continuousView_returnToFocus%',
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
  /** Current phrase-interaction mode; controls token click behavior in the strip. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token ref → segment id lookup; used to resolve the focused token's segment for slot rules. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → flat book-level index; used to sort phrase tokens in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Word token ref → token lookup; used to resolve the focused word token. */
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
 * A focus move centers the group holding the focused token, and the arrows move focus by one group
 * so scroll and highlight follow the store write; they are disabled when the first or last phrase
 * is focused. Between those moves the mounted groups follow what is on screen rather than the
 * focus, so scrolling may carry the focused phrase off the strip entirely — a dedicated control
 * brings it back.
 */
export default function ContinuousView({
  book,
  editPhraseSegmentId,
  phraseMode,
  setPhraseMode,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
  viewOptions,
}: ContinuousViewProps) {
  // Focus drives every scroll, highlight and slot decision here; its origin decides whether a
  // change glides or fades. See FocusOrigin.
  const { tokenRef: focusedTokenRef, origin: focusOrigin } = useFocus();
  const getFocus = useFocusGetter();
  const { focusToken } = useFocusActions();

  const { hideInactiveLinkButtons, simplifyPhrases, showMorphology, freeScrollStrip } = viewOptions;
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
   * Token ref that the strip is currently displaying as focused. Lags the live focus through the
   * fade-out for a jump it has to travel, so the window/scroll/highlight don't shift until the
   * strip has faded out. For its own arrow/click moves this is updated immediately so the smooth
   * scroll starts on the same frame.
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
   * back to the live focus first — it is reseeded to the new book's active verse on the book change
   * — so the transient lands on the intended verse rather than book start.
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
   * Whether the displayed-focus update just applied — or still pending behind the fade — came from
   * a move this strip made. Carried from the focus-change effect to the scroll effect, which the
   * fade timer can separate.
   */
  const lastDisplayUpdateWasInternalRef = useRef(false);

  /**
   * Ref mirror of the rendered focus index, read only as the fallback for a step whose live focus
   * this book cannot place. A ref, so a step keeps one identity across focus moves.
   */
  const focusPhraseIndexRef = useLatestRef(focusPhraseIndex);

  /** DOM ref array indexed by group index; used to scroll the focused phrase box into view. */
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /** Ref-setter callbacks for {@link phraseRefs}, keyed by the group index each one writes. */
  const groupRefSetters = useRef(new Map<number, (el: HTMLSpanElement | null) => void>());

  /**
   * Book that {@link groupRefSetters} holds closures for. They are keyed by absolute group index,
   * which a different book reuses for different groups, and the component instance survives a book
   * change — so without dropping them here the map would keep growing to the largest book ever
   * opened. Cleared during render rather than in an effect: the new book's groups take their
   * setters during the render that precedes the effect, and clearing afterward would drop the
   * identities those groups are already holding.
   *
   * Only the map is cleared. {@link phraseRefs} is written by ref callbacks, so every unmounting
   * group nulls its own index — and a discarded render (an interrupted concurrent render, a
   * StrictMode double-invoke) would advance the book id here without repeating the clear, leaving
   * the still-mounted old DOM with no refs and every centering call a silent no-op. A discarded
   * render costs the map nothing worse than one extra render of the memoized groups.
   */
  const refsBookIdRef = useRef(book.id);
  if (refsBookIdRef.current !== book.id) {
    refsBookIdRef.current = book.id;
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
   * Whether the reader's own scrolling currently owns the scroll position, which suspends every
   * centering path until a focus move takes it back.
   */
  const suppressCenteringRef = useRef(false);

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
    // While the reader owns the scroll, every centering path stands down. The gate sits here rather
    // than at the call sites because the window re-derives the focused index as it mounts and
    // culls, which fires the focus-keyed paths under a focus that never moved — so the hold has to
    // cover paths whose own effect has no reason to know about free scrolling.
    /* v8 ignore next -- the fight this prevents needs real layout to shift the focused index, which jsdom does not do */
    if (suppressCenteringRef.current) return;
    phraseRefs.current[groupIndex]?.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  /**
   * Cancel function of the most recently started {@link holdCentered}, so a hold can be dropped by
   * whatever supersedes it: a newer hold, or a focus move that makes the held group the wrong one.
   * What sits here may already have been canceled — canceling twice is a no-op, so nothing clears
   * it.
   */
  const activeHoldCancelRef = useRef<(() => void) | undefined>(undefined);

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
   * Starting a hold supersedes any hold already running, so callers need not cancel first. A hold
   * pins one specific group index, and two alive at once would re-center to different places on
   * alternating frames, leaving the strip wherever the later tick happened to land.
   *
   * @returns A cancel function that stops the loop, the observer, and the hard-deadline timer; call
   *   it from the owning effect's cleanup.
   */
  const holdCentered = useCallback(
    (groupIndex: number) => {
      activeHoldCancelRef.current?.();
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
      const cancel = () => {
        clearTimeout(hardStopTimer);
        cancelAnimationFrame(rafId);
        observer.disconnect();
      };
      activeHoldCancelRef.current = cancel;
      return cancel;
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
   * Segment id whose link buttons are currently treated as active, lagging the live focus while the
   * strip glides. Toggling this adds/removes inactive link icons, which re-lays out the whole
   * strip; deferring it until the smooth scroll settles keeps the animation a pure one-token glide
   * with no mid-flight box shifts. For a jump and for the initial mount it tracks the focus
   * immediately (the strip is faded out or static, so there is no animation to disturb).
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
   * The focus last seen by the segmentation-reconcile effect below, so it can distinguish "the
   * focused token's segment id changed because the segmentation changed" (commit immediately) from
   * "focus moved" (the focus-change machinery owns the commit timing).
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

  /**
   * Set when the render window resized while an internal-nav glide was still animating, so the
   * settle can re-center once. Centering mid-glide would truncate it into a snap, but the groups a
   * resize mounts shift the focused box sideways and a scroll animation fixes its target only at
   * the start — so without a correction at the settle the glide lands off-center.
   */
  const windowChangedDuringScrollRef = useRef(false);

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

  // Name the initially-focused token on mount so the segment list scrolls the active verse into
  // view on first render. Only fires when nothing has resolved a focus already.
  useEffect(() => {
    if (focusedTokenRef !== undefined) return;
    const initialGroup = phraseGroups[focusPhraseIndex];
    const initialRef = initialGroup?.tokens[0]?.ref;
    if (initialRef !== undefined) focusToken(initialRef, 'seed');
    // Intentionally runs only on mount; do not add deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atStart = phraseGroups.length === 0 || focusPhraseIndex === 0;
  const atEnd = phraseGroups.length === 0 || focusPhraseIndex >= phraseGroups.length - 1;

  /**
   * Whether a step would count from a position the reader cannot see: the strip is mid-jump,
   * holding the group focus left on screen for {@link RECENTER_FADE_MS} while it fades, and the fade
   * does not cover the input that steps through it.
   *
   * A glide leaves the displayed focus lagging too, but only until the focus-change effect adopts
   * it, which React reaches within the same discrete event as the press. Testing the origin rather
   * than the lag alone keeps that transient out of the gate on purpose instead of on scheduling: a
   * step there counts from the group the strip is already travelling to, and refusing it would drop
   * the second of a pair of rapid presses.
   */
  const isStepBlocked = focusedTokenRef !== displayFocusedTokenRef && focusOrigin !== 'strip';

  /**
   * Ref mirror of the step gate, so a handler can consult it while keeping one identity across the
   * fade that raises it.
   */
  const isStepBlockedRef = useLatestRef(isStepBlocked);

  const stripOpacityClass = isVisible ? 'tw:opacity-100' : 'tw:opacity-0';

  /**
   * The bounds of the mounted groups, anchored to what is on screen rather than to the focus, so a
   * reader who scrolls the strip away from the focused phrase keeps finding mounted content.
   */
  const {
    range: scrollWindowRange,
    leadingSentinelRef,
    trailingSentinelRef,
    recenterOnFocus,
  } = usePhraseWindow({
    total: phraseGroups.length,
    focusIndex: focusPhraseIndex,
    viewportRef: scrollViewportRef,
  });

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
   *
   * Widening is applied here rather than inside the window hook because it is the one part of the
   * bounds that depends on phrase membership; the hook itself reasons only about indices and
   * geometry, so it stays free of the analysis model.
   */
  const [renderWindowStart, renderWindowEnd] = useMemo(() => {
    let start = Math.max(0, scrollWindowRange.start);
    let end = Math.min(phraseGroups.length - 1, scrollWindowRange.end - 1);
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
  }, [scrollWindowRange, phraseGroups, groupSpanByPhraseId]);

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
   * Advances focus by `delta` phrases, which re-derives `focusPhraseIndex` and triggers the scroll
   * effect.
   *
   * Counts from the focus as of the press, taken from the store rather than from the rendered
   * index. That is what makes a second press before the re-render accumulate instead of repeating
   * the first, and what keeps a step right when a phrase-link edit has regrouped the strip without
   * moving focus.
   *
   * @param delta - Number of phrases to move (positive = forward, negative = backward).
   */
  const step = useCallback(
    (delta: number) => {
      /* v8 ignore next -- arrow buttons are disabled when phraseGroups is empty */
      if (phraseGroups.length === 0) return;
      const currentRef = getFocus().tokenRef;
      /* v8 ignore next 2 -- a focus always resolves while the strip has groups to step through */
      const from =
        (currentRef === undefined ? undefined : groupIndexByTokenRef.get(currentRef)) ??
        focusPhraseIndexRef.current;
      const nextIndex = from + delta;
      /* v8 ignore next -- disabled buttons prevent under/overflow */
      const clamped = nextIndex < 0 ? 0 : Math.min(nextIndex, phraseGroups.length - 1);
      /* v8 ignore next -- disabled buttons prevent clicking when already at boundary */
      if (clamped === from) return;
      const nextRef = phraseGroups[clamped]?.tokens[0]?.ref;
      if (nextRef !== undefined) focusToken(nextRef, 'strip');
    },
    [phraseGroups, groupIndexByTokenRef, getFocus, focusToken, focusPhraseIndexRef],
  );

  /**
   * Brings the strip back to the focused phrase after scrolling has carried it away, leaving the
   * focus itself where it is.
   */
  const returnToFocus = useCallback(() => {
    // Asking for the focus back is the reader handing the scroll over, so centering resumes.
    suppressCenteringRef.current = false;
    // Rebuild before centering: scrolling may have culled the focused group, leaving nothing on
    // screen to scroll to. The hold then keeps it centered while the restored groups lay out.
    recenterOnFocus();
    centerGroup(focusPhraseIndex, 'auto');
    holdCentered(focusPhraseIndex);
  }, [recenterOnFocus, centerGroup, holdCentered, focusPhraseIndex]);

  /** Moves focus one phrase backward. */
  const stepPrev = useCallback(() => step(-1), [step]);

  /** Moves focus one phrase forward. */
  const stepNext = useCallback(() => step(1), [step]);

  /**
   * Travels the strip by one wheel notch, so a wheel over it moves the text the way a wheel moves
   * any other scrollable region. What a notch moves is the reader's choice: under `freeScrollStrip`
   * it scrolls the strip and leaves the focus alone, otherwise it steps the focus one phrase and
   * the strip follows. Either way the notch is spent here rather than also scrolling an ancestor.
   *
   * A notch counts in document order rather than screen direction: wheeling down always moves
   * further into the text, whichever way the script runs.
   */
  const handleWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      // A mouse reports the notch on the vertical axis and a trackpad swipe on the horizontal one;
      // over a horizontal strip both mean travel, so take whichever axis the gesture favors.
      const rawDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (rawDelta === 0) return;
      // Normalized to pixels up front, so the gain and the per-event ceiling below are both
      // expressed in one unit whatever the device reports in.
      const delta = rawDelta * wheelDeltaScale(event.deltaMode, scrollViewportRef.current);
      if (freeScrollStrip) {
        // Keeps the browser from scrolling an ancestor alongside the travel applied below.
        event.preventDefault();
        // The reader is driving from here until a focus move takes the scroll back.
        suppressCenteringRef.current = true;
        activeHoldCancelRef.current?.();
        const viewport = scrollViewportRef.current;
        if (viewport) {
          // Clamped to what is mounted: the ceiling rises as the sentinels mount more groups, so a
          // scroll runs on mid-book and stops at the book's end. An RTL scroll container counts its
          // offsets from zero at the strip's start down through negatives to its end, inverting
          // both the range and the direction that travels further into the text.
          const extent = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
          const minScroll = isRtl ? -extent : 0;
          const maxScroll = isRtl ? 0 : extent;
          const wanted = delta * WHEEL_SCROLL_GAIN * (isRtl ? -1 : 1);
          const travel = Math.sign(wanted) * Math.min(Math.abs(wanted), MAX_WHEEL_TRAVEL_PX);
          viewport.scrollLeft = Math.max(
            minScroll,
            Math.min(viewport.scrollLeft + travel, maxScroll),
          );
        }
        return;
      }
      // A step mid-jump would count from the phrase still on screen, which the focus has already
      // left — the same reason the arrows are disabled through that window. Refused before the
      // notch is claimed below, so it still scrolls the panel rather than doing nothing at all.
      if (isStepBlockedRef.current) return;
      // Claiming the notch keeps one gesture to one effect: stepping a phrase and scrolling an
      // ancestor at once is hard to aim.
      event.preventDefault();
      step(delta > 0 ? 1 : -1);
    },
    [step, isStepBlockedRef, freeScrollStrip, isRtl],
  );

  // Subscribed explicitly rather than through the JSX prop, which React attaches passively — and a
  // passive listener may not call `preventDefault`, which is what keeps the browser from scrolling
  // an ancestor alongside the travel this handler applies.
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    /* v8 ignore next -- the viewport is attached before effects run */
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  /**
   * Focuses the phrase whose first token is `ref`; scroll and highlight follow. Selecting the
   * already-focused phrase is a no-op.
   *
   * Reads the focus at click time rather than closing over it, so the handler keeps one identity
   * across focus moves and passing it down cannot invalidate a memoized child.
   *
   * @param ref - First-token ref (group key) of the selected phrase.
   */
  const handlePhraseSelect = useCallback(
    (ref: string) => {
      const targetGroupIndex = groupIndexByTokenRef.get(ref);
      const currentFocus = getFocus().tokenRef;
      /* v8 ignore next 2 -- a focus is always resolved before a phrase box can be clicked */
      const currentGroupIndex =
        currentFocus === undefined ? undefined : groupIndexByTokenRef.get(currentFocus);
      if (targetGroupIndex !== undefined && targetGroupIndex === currentGroupIndex) return;
      focusToken(ref, 'strip');
    },
    [getFocus, groupIndexByTokenRef, focusToken],
  );

  /** Splits a phrase arc at a token boundary and dispatches the resulting phrase-store writes. */
  const handleArcSplit = useArcSplitHandler(tokenDocOrder);

  /**
   * Handle of the fade a jump is waiting out, or `undefined` when none is pending. A ref rather
   * than the effect's own cleanup, so cancelling a fade is something a run decides: a cleanup drops
   * the timer before the run that superseded it can tell there was one.
   */
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Drops a pending fade and reports whether there was one to drop. */
  const cancelPendingFade = useCallback(() => {
    if (fadeTimeoutRef.current === undefined) return false;
    clearTimeout(fadeTimeoutRef.current);
    fadeTimeoutRef.current = undefined;
    return true;
  }, []);

  // React to focus moves. For a move this strip made, apply the change immediately and
  // smooth-scroll. For every other origin, fade the strip out, wait for the fade to complete, then
  // snap the displayed focus into place so the scroll happens behind the curtain.
  //
  // A move supersedes any fade in flight, so it owes the reveal that fade will never run —
  // including a move back onto what is already displayed, which has nothing to travel to.
  useEffect(() => {
    if (focusedTokenRef === displayFocusedTokenRef) {
      if (cancelPendingFade()) setIsVisible(true);
      return;
    }
    // A focus move takes the scroll back from the reader, so centering resumes for it and for
    // everything the strip does afterwards.
    suppressCenteringRef.current = false;
    cancelPendingFade();
    const isInternal = focusOrigin === 'strip';
    if (isInternal) {
      lastDisplayUpdateWasInternalRef.current = true;
      setIsVisible(true);
      setDisplayFocusedTokenRef(focusedTokenRef);
      return;
    }
    lastDisplayUpdateWasInternalRef.current = false;
    setIsVisible(false);
    fadeTimeoutRef.current = setTimeout(() => {
      fadeTimeoutRef.current = undefined;
      setDisplayFocusedTokenRef(focusedTokenRef);
    }, RECENTER_FADE_MS);
    // focusOrigin classifies the move that changed focusedTokenRef, so it is never itself a reason
    // to re-run. Reading it unlisted is safe because the origin cannot move while the token ref
    // holds still — see FocusStore.write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedTokenRef, displayFocusedTokenRef, cancelPendingFade]);

  // Clear a pending fade on unmount so its deferred update never lands on a torn-down tree.
  useEffect(
    () => () => {
      cancelPendingFade();
    },
    [cancelPendingFade],
  );

  // Scroll the focused phrase into view whenever the displayed focus changes. Smooth-scroll for
  // internal nav (the displayed ref was updated immediately, so the prop and display agree); snap
  // for external jumps (the displayed ref was just updated post-fade) and for the initial mount.
  //
  // "Internal" here means the move carried this strip's own origin. The segment window asks a
  // different question — whether any view in the tree originated the nav — so the two classify the
  // same event differently by design. See FocusOrigin.
  useEffect(() => {
    // Drop any hold still running: it pins the group the focus just left. Such a hold is armed by
    // something the focus does not control (a window resize, an active-segment flip) and keeps
    // watching the content row long after it, so the window slide this move causes would restart
    // it and instant-scroll back every frame — overriding the glide below and leaving the strip
    // parked on the phrase the reader navigated away from.
    activeHoldCancelRef.current?.();
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
      // `scrollIntoView` scrolls the nearest scrollable ancestor, which is the clipping viewport —
      // the content row is deliberately not one. The row is listened to anyway so a layout that
      // ever made it scrollable again would still report its settle rather than silently falling
      // back to the timeout. Commit on the first signal, then tear everything down so the relayout
      // runs exactly once.
      const scrollers = [scrollViewportRef.current, stripRowRef.current];
      let fallbackTimeout: ReturnType<typeof setTimeout>;
      // Mark the settle pending so the segmentation-reconcile effect and the window-resize effect
      // defer to `onSettled` instead of snapping the glide short if a boundary edit or a window
      // resize lands mid-scroll.
      scrollSettlePendingRef.current = true;
      windowChangedDuringScrollRef.current = false;
      /**
       * Commits the pending active segment, applies any centering the glide had to defer, and tears
       * down both the timeout and scroll listeners.
       */
      const onSettled = () => {
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
        scrollSettlePendingRef.current = false;
        if (windowChangedDuringScrollRef.current) {
          windowChangedDuringScrollRef.current = false;
          centerGroup(focusPhraseIndex, 'auto');
          holdCentered(focusPhraseIndex);
        }
        commitPendingActiveSegment();
      };
      fallbackTimeout = setTimeout(onSettled, SCROLL_SETTLE_FALLBACK_MS);
      scrollers.forEach((el) => el?.addEventListener('scrollend', onSettled, { once: true }));
      return () => {
        cancelAnimationFrame(navRafId);
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
        scrollSettlePendingRef.current = false;
        // Whatever superseded this glide owns the centering from here; a pending correction for a
        // window change that happened during it would pull the strip back to the old focus.
        windowChangedDuringScrollRef.current = false;
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

  /**
   * `focusPhraseIndex` last seen by the window-start recenter effect, so it can tell a window that
   * grew start-ward under a stationary focus from one that moved because the focus did. Only the
   * former is this effect's to correct; the focus-change machinery owns the latter, and centering
   * against it would fight the glide.
   */
  const prevFocusForWindowStartRef = useRef(focusPhraseIndex);

  // Re-center the focused group when the window's leading edge moves. Mounting groups *ahead* of
  // the focus at an unchanged scroll offset slides the focused group sideways by their combined
  // width — on a panel drag, far enough to carry the phrase the reader is working on off the strip.
  // Only the start matters; groups mounted after the focus cost it nothing. The focus itself has
  // not moved, so no focus-keyed centering path fires, and the browser does not absorb it either:
  // scroll anchoring adjusts the block axis only, and this strip scrolls on the inline axis. A
  // layout effect, so the correction is in place before the shifted frame is painted rather than
  // showing as a jump. The correction then holds: the groups just mounted finish laying out their
  // glosses, morpheme rows, and arcs over the following frames, and every such reflow left of the
  // focus shifts it again.
  //
  // Keyed on the start rather than the window size because the two have separate causes: the size
  // changes on a resize, while the bounds also widen start-ward to keep every fragment of a
  // discontiguous phrase mounted, so a new phrase link alone can mount groups ahead of the focus.
  //
  // The focus is a dependency too, purely to keep the guard's baseline current. A focus move has its
  // own scroll effect above and the guard hands those runs straight back, but the start does not
  // move on every focus move — clamped at the book's start, or offset by a compensating window
  // change — and a baseline left behind by one of those makes the next genuine start move read as a
  // focus move and lose its correction.
  //
  // Free scrolling gives the scroll position to the reader, so this correction stands down there:
  // the groups a scroll mounts would otherwise fire it and drag the strip back to a focus the
  // reader has deliberately scrolled away from. Only a focus move re-asserts centering.
  useLayoutEffect(() => {
    const focusUnchanged = prevFocusForWindowStartRef.current === focusPhraseIndex;
    prevFocusForWindowStartRef.current = focusPhraseIndex;
    if (!focusUnchanged) return undefined;
    if (freeScrollStrip) return undefined;
    // A sentinel reaching the viewport can grow the window while an arrow step's own glide is still
    // animating. Centering instantly would land the strip on the target before the animation could
    // run and pin it there, turning the glide into a snap, so a glide in flight defers the
    // correction to its settle.
    if (scrollSettlePendingRef.current) {
      windowChangedDuringScrollRef.current = true;
      return undefined;
    }
    centerGroup(focusPhraseIndex, 'auto');
    return holdCentered(focusPhraseIndex);
    // centerGroup and holdCentered are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderWindowStart, focusPhraseIndex, freeScrollStrip]);

  // When entering edit or confirm-unlink mode, smooth-scroll to the first group of the active
  // phrase by focusing its first token. Scroll then follows through focusPhraseIndex.
  useEffect(() => {
    if (phraseMode.kind === 'view') return;
    const targetPhraseId = phraseMode.phraseId;
    const group = phraseGroups.find((g) => g.phraseLink?.analysisId === targetPhraseId);
    const nextRef = group?.tokens[0]?.ref;
    /* v8 ignore next -- phrase always has tokens; the focus differs at mode entry */
    if (nextRef === undefined || nextRef === focusedTokenRef) return;
    focusToken(nextRef, 'strip');
    // phraseGroups and the focus are read once per mode change; intentionally not deps so the
    // effect only fires on actual mode transitions. focusToken has a stable identity.
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
   * Group index of the live focused token. Used per-slot to compute `focusedSideIsPrev` from the
   * same source as `focus.focusedPhraseLink` / `focus.focusedFreeToken` so link direction and link
   * target can never disagree.
   */
  const focusedGroupIndex = useMemo(
    () => (focusedTokenRef !== undefined ? groupIndexByTokenRef.get(focusedTokenRef) : undefined),
    [focusedTokenRef, groupIndexByTokenRef],
  );

  /**
   * Resolved focus context — what's focused, what segment it's in, what phrase it belongs to. Built
   * from the fade-gated `displayFocusedTokenRef` (not the live focus) so every highlight and
   * link-button active/disabled decision moves only at the recenter midpoint, behind the fade —
   * never re-evaluating (and dimming the buttons) on the still-visible old strip the instant an
   * external nav reseeds the live focus. The scroll target (`focusedGroupIndex`) still uses the
   * live ref so the jump lands on the new verse behind the curtain. Mirrors SegmentView, which is
   * fed the segment window's own gated display ref.
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
        disabled={atStart || isStepBlocked}
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
              // Deliberately not a scroll container: the viewport around it does the clipping, and
              // a second scroller is one the browser drives itself — inertia and all — past
              // whatever the wheel handler decides.
              className="tw:no-scrollbar tw:pointer-events-none tw:relative tw:z-60 tw:flex tw:w-max tw:items-start tw:gap-1 tw:pb-2"
              ref={stripRowRef}
              style={{
                paddingTop: `${stripTopPadding}px`,
                paddingLeft: `${stripLeftPadding}px`,
                paddingRight: `${stripRightPadding}px`,
              }}
              onMouseLeave={clearAllHoverState}
            >
              {/* Zero-width markers whose arrival at either edge grows the mounted window */}
              <span
                aria-hidden="true"
                data-testid="strip-leading-sentinel"
                ref={leadingSentinelRef}
              />
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
              <span
                aria-hidden="true"
                data-testid="strip-trailing-sentinel"
                ref={trailingSentinelRef}
              />
            </div>
          </PhraseStripProvider>
        </div>
      </div>

      {/* Next navigation arrow */}
      <Button
        aria-label={localizedStrings['%interlinearizer_continuousView_nextToken%']}
        disabled={atEnd || isStepBlocked}
        onClick={stepNext}
        size="icon-sm"
        tabIndex={-1}
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true">{isRtl ? '\u2190' : '\u2192'}</span>
      </Button>

      {/* Brings the strip back to the focused phrase, which scrolling may have carried off screen */}
      <Button
        aria-label={localizedStrings['%interlinearizer_continuousView_returnToFocus%']}
        onClick={returnToFocus}
        size="icon-sm"
        tabIndex={-1}
        type="button"
        variant="ghost"
      >
        <LocateFixed className="tw:size-3" />
      </Button>
    </div>
  );
}
