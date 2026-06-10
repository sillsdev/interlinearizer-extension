import { useLocalizedStrings } from '@papi/frontend/react';
import type { Book, Token } from 'interlinearizer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';
import { usePhraseDispatch, usePhraseLinkByIdMap, usePhraseLinkMap } from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';
import { isWordToken } from '../types/type-guards';
import { PhraseStripProvider } from './PhraseStripContext';
import type { PhraseStripContextValue } from './PhraseStripContext';
import { PhraseStrip, LINK_SLOT_TRANSITION_MS, type StripItem } from './PhraseStripParts';
import type { LinkSlot, TokenGroup } from '../types/token-layout';
import { buildRenderUnits, groupTokens, resolveFocusContext } from '../utils/token-layout';
import { useArcPaths } from '../hooks/useArcPaths';
import { usePhraseHoverState } from '../hooks/usePhraseHoverState';
import useLatestRef from '../hooks/useLatestRef';
import MemoizedArcOverlay from './ArcOverlay';
import { RECENTER_FADE_MS, RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/**
 * Clamps `index` to `[0, len - 1]`, returning `0` when `len` is zero.
 *
 * @param index - The raw index to clamp.
 * @param len - Length of the target array.
 * @returns A safe index guaranteed to be within bounds.
 */
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
 * Number of phrase slots rendered on each side of the focused phrase. Chosen large enough that no
 * realistic viewport can ever render all tokens simultaneously.
 */
const PHRASE_WINDOW_HALF = 100;

/**
 * Localized string keys this view needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders. A fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render, escalating into an infinite update loop that freezes
 * the WebView.
 */
const STRING_KEYS = [
  '%interlinearizer_linkButton_crossSegmentDisabledTooltip%',
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
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. Passed to `PhraseBox`. */
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
  /** Word token ref → token lookup; used to resolve the focused token from `focusedTokenRef`. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * When `true`, link/unlink buttons between phrases are hidden except in the segment containing
   * the focused token (the active verse within the strip).
   */
  hideInactiveLinkButtons: boolean;
  /**
   * When `true`, phrase-level controls (split, intra-phrase unlink, remove-token) are hidden on
   * every phrase except the focused one.
   */
  simplifyPhrases: boolean;
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
 *
 * @param props - Component props
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited; passed to `PhraseBox`
 * @param props.focusedTokenRef - Single source of truth for focus + scroll position
 * @param props.onFocusedTokenRefChange - Called when arrow navigation or click changes focus
 * @param props.phraseMode - Current phrase-interaction mode; controls token click behavior
 * @param props.setPhraseMode - Setter for `phraseMode`; passed to phrase boxes for mode transitions
 * @param props.tokenSegmentMap - Token ref → segment id lookup for focus resolution
 * @param props.wordTokenByRef - Word token ref → token lookup for focus resolution
 * @param props.hideInactiveLinkButtons - When true, link buttons between phrases are hidden outside
 *   the focused token's segment.
 * @param props.simplifyPhrases - When true, phrase-level controls are hidden on every phrase except
 *   the focused one.
 * @returns A horizontal phrase strip with previous/next navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  book,
  editPhraseSegmentId,
  focusedTokenRef,
  onFocusedTokenRefChange,
  phraseMode,
  setPhraseMode,
  tokenSegmentMap,
  wordTokenByRef,
  hideInactiveLinkButtons,
  simplifyPhrases,
}: ContinuousViewProps) {
  const isRtl = document.documentElement.dir === 'rtl';

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  const committedPhraseLinkByRef = usePhraseLinkMap();
  const committedPhraseLinkById = usePhraseLinkByIdMap();

  /**
   * Token list of the phrase currently being edited, or `undefined` outside edit mode. Hoisted to a
   * single lookup here rather than recomputed per group; passed into each `PhraseGroup`.
   */
  const editPhraseTokens = useMemo(
    () =>
      phraseMode.kind === 'edit'
        ? /* v8 ignore next -- phrase always exists in the store when edit mode is entered */
          committedPhraseLinkById.get(phraseMode.phraseId)?.tokens
        : undefined,
    [phraseMode, committedPhraseLinkById],
  );

  /** Maps each word token ref to its flat document index for document-order phrase merges. */
  const tokenDocOrder = useMemo(() => {
    const map = new Map<string, number>();
    allTokens.filter(isWordToken).forEach((t, i) => map.set(t.ref, i));
    return map;
  }, [allTokens]);

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

  /** Flat token index -> owning segment lookup; used for per-slot segment resolution. */
  const tokenSegment = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens.map(() => seg)),
    [book.segments],
  );

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
  // Keep in sync with the rendered value so external jumps reset the pending index. When an
  // internal nav is still in flight (the parent hasn't echoed back yet), do not overwrite: a rapid
  // second click needs to read the already-advanced pending index rather than the stale rendered
  // focusPhraseIndex.
  if (internalFocusedTokenRefRef.current === undefined) {
    pendingPhraseIndexRef.current = focusPhraseIndex;
  }

  /** DOM ref array indexed by group index; used to scroll the focused phrase box into view. */
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

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

  /** Ref to the token-strip row; the content row and mouse-leave target. */
  // eslint-disable-next-line no-null/no-null
  const stripRowRef = useRef<HTMLDivElement | null>(null);

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

  /** Ref mirror of `onFocusedTokenRefChange` so callbacks never need it as a dep. */
  const onFocusedTokenRefChangeRef = useLatestRef(onFocusedTokenRefChange);

  /**
   * Emits a focus change that originated _inside_ the strip (arrow nav, phrase click, edit-mode
   * jump). Records the ref as internally-originated, then notifies the parent. When the parent
   * echoes the same ref back through `focusedTokenRef`, the focus-change effect recognizes the
   * match and applies it immediately with a smooth scroll instead of the fade-then-snap used for
   * external jumps. Folds the stamp and the notify into one call so the "this is an internal emit"
   * intent lives in a single place rather than being restated at each call site.
   *
   * @param ref - The word-token ref to focus.
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

  /** The inclusive group-index bounds of the rendered window. */
  const renderWindowStart = Math.max(0, focusPhraseIndex - PHRASE_WINDOW_HALF);
  const renderWindowEnd = Math.min(phraseGroups.length - 1, focusPhraseIndex + PHRASE_WINDOW_HALF);

  /**
   * The groups in the rendered window. Memoized on the bounds (and the source groups) so the array
   * identity is stable while the window is unchanged. This matters because `renderWindowGroups`
   * feeds the `useArcPaths` dependency list: a fresh `.slice()` every render would bump the hook's
   * internal version counter every render, forcing a re-measure on each pass and defeating the arc
   * hook's own loop-damping (which keys off whether a real input changed).
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

  /**
   * Notifies the parent that the user selected the phrase whose first token is `ref`. The parent
   * echoes the new token ref back through `focusedTokenRef`; scroll + highlight follow
   * automatically.
   *
   * @param ref - First-token ref (group key) of the selected phrase.
   */
  const handlePhraseSelect = useCallback(
    (ref: string) => {
      const targetGroupIndex = groupIndexByTokenRef.get(ref);
      const currentGroupIndex =
        focusedTokenRef === undefined ? undefined : groupIndexByTokenRef.get(focusedTokenRef);
      if (targetGroupIndex !== undefined && targetGroupIndex === currentGroupIndex) return;
      emitInternalFocus(ref);
    },
    [focusedTokenRef, groupIndexByTokenRef, emitInternalFocus],
  );

  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

  /**
   * Splits a phrase arc at a token boundary and dispatches the resulting create/update/delete
   * operations. No-ops if `phraseId` is not in `committedPhraseLinkById`.
   *
   * @param phraseId - Id of the phrase arc to split.
   * @param splitAfterTokenRef - Token ref at whose trailing boundary the split is made.
   */
  const handleArcSplit = useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = committedPhraseLinkById.get(phraseId);
      if (!phraseLink) return;
      splitPhraseAtBoundary(
        phraseLink,
        splitAfterTokenRef,
        { createPhrase, updatePhrase, deletePhrase },
        tokenDocOrder,
      );
    },
    [committedPhraseLinkById, tokenDocOrder, createPhrase, updatePhrase, deletePhrase],
  );

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
      /** Commits the pending active segment and tears down both the timeout and scroll listeners. */
      const onSettled = () => {
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
        commitPendingActiveSegment();
      };
      fallbackTimeout = setTimeout(onSettled, SCROLL_SETTLE_FALLBACK_MS);
      scrollers.forEach((el) => el?.addEventListener('scrollend', onSettled, { once: true }));
      return () => {
        cancelAnimationFrame(navRafId);
        clearTimeout(fallbackTimeout);
        scrollers.forEach((el) => el?.removeEventListener('scrollend', onSettled));
      };
    }

    if (isInitialLoad) isInitialLoadInProgressRef.current = false;

    // Defer the fade-in until after the browser applies the instant scroll position.
    const rafId = requestAnimationFrame(() => {
      setIsVisible(true);
      // The snapped-slot paint has happened; re-enable the transition for later in-view toggles.
      setSkipSlotTransitionForJump(false);
    });
    return () => {
      cancelAnimationFrame(rafId);
      setIsVisible(true);
    };
  }, [focusPhraseIndex, commitPendingActiveSegment, centerGroup]);

  // Keep the focused group pinned dead-center after the deferred active-segment flip. When
  // `committedActiveSegmentId` flips (after an internal-nav scroll settles), inactive link icons
  // fade in/out over `LINK_SLOT_TRANSITION_MS`. Because they are hidden via `opacity: 0` their
  // layout space is preserved, so boxes do not shift — but any residual sub-pixel drift from the
  // preceding smooth scroll is corrected by re-centering once before paint. The rAF loop holds the
  // group centered for the full fade duration as a conservative guard against any future layout
  // changes that could re-introduce drift. The first run is skipped because the initial center is
  // established by the scroll effect's instant jump. A `useLayoutEffect` seeds the loop so the very
  // first re-center lands before paint (no initial flash), then `rAF` carries it through the fade.
  const skipActiveSegmentRecenterRef = useRef(true);
  useLayoutEffect(() => {
    if (skipActiveSegmentRecenterRef.current) {
      skipActiveSegmentRecenterRef.current = false;
      return undefined;
    }
    /** Re-centers the focused group; called synchronously now and each `rAF` until the deadline. */
    const recenter = () => centerGroup(focusPhraseIndex, 'auto');
    recenter();
    const deadline = performance.now() + LINK_SLOT_TRANSITION_MS;
    let rafId = requestAnimationFrame(function recenterFrame() {
      recenter();
      if (performance.now() < deadline) rafId = requestAnimationFrame(recenterFrame);
    });
    return () => cancelAnimationFrame(rafId);
    // Only the active-segment flip should trigger this re-anchor; focusPhraseIndex has its own scroll
    // effect. Reading it here is a snapshot, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedActiveSegmentId]);

  // Re-center the focused group when a view option toggles. Toggling `simplifyPhrases` changes
  // the strip's layout, so the previously-centered group may drift off-center; snap it back into
  // view. `hideInactiveLinkButtons` is excluded: inactive link slots now reserve their space even
  // when hidden (`opacity: 0`; clickability is guarded at the button level), so toggling it does
  // not shift the layout.
  useEffect(() => {
    centerGroup(focusPhraseIndex, 'auto');
    // focusPhraseIndex is intentionally excluded: it has its own scroll effect above. This effect
    // only re-centers in response to layout-affecting option toggles. centerGroup is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simplifyPhrases]);

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

  const candidatePhraseIds = useMemo<ReadonlySet<string>>(() => {
    if (candidateTokenRefs.size === 0) return new Set();
    const ids = new Set<string>();
    committedPhraseLinkByRef.forEach((link) => {
      if (link.tokens.some((t) => candidateTokenRefs.has(t.tokenRef))) ids.add(link.analysisId);
    });
    return ids;
  }, [candidateTokenRefs, committedPhraseLinkByRef]);

  /**
   * Strip-wide context value shared by every phrase group and link slot. Memoized so the leaf
   * `MemoizedPhraseBox` / `MemoizedTokenLinkIcon` consumers don't re-render on unrelated changes.
   * `setHoveredPhraseId` doubles as both the phrase-hover and candidate-phrase hover callback.
   */
  const stripContext = useMemo<PhraseStripContextValue>(
    () => ({
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
      skipLinkTransition: !isVisible || skipSlotTransitionForJump,
    }),
    [
      phraseMode,
      setPhraseMode,
      editPhraseTokens,
      editPhraseSegmentId,
      tokenSegmentMap,
      tokenDocOrder,
      setHoveredPhraseId,
      setCandidateTokenRefs,
      handleHoverSplitFreeTokens,
      hideInactiveLinkButtons,
      simplifyPhrases,
      committedActiveSegmentId,
      isVisible,
      skipSlotTransitionForJump,
      localizedStrings,
    ],
  );

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
   * Interleaved render units (groups + link slots) in document order across the window. Built from
   * the window token slice using the shared {@link buildRenderUnits} utility, then each group unit
   * is annotated with its absolute group index.
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
              ? tokenSegment[phraseGroups[item.prevGroupIndex].firstIndex]?.id
              : undefined;
          const nextSegmentId =
            item.nextGroupIndex !== undefined && phraseGroups[item.nextGroupIndex] !== undefined
              ? tokenSegment[phraseGroups[item.nextGroupIndex].firstIndex]?.id
              : undefined;
          return {
            kind: 'slot',
            key,
            slot: item.slot,
            prevSegmentId,
            nextSegmentId,
            focusedSideIsPrev: focusedSideIsPrevByItem.get(item),
          };
        }
        const { group, groupIndex } = item;
        return {
          kind: 'group',
          key: group.tokens[0].ref,
          group,
          isFocused: group.tokens.some((t) => t.ref === displayFocusedTokenRef),
          // New closure per recomputation; React briefly nulls and reassigns each ref, but the
          // cycle is synchronous and harmless. If renders become hot, move the assignment into
          // MemoizedPhraseGroup (pass phraseRefs + groupIndex as props instead of a callback).
          groupRef: (el: HTMLSpanElement | null) => {
            phraseRefs.current[groupIndex] = el;
          },
        };
      }),
    [
      renderItems,
      phraseGroups,
      tokenSegment,
      focusedSideIsPrevByItem,
      displayFocusedTokenRef,
      phraseRefs,
    ],
  );

  return (
    <div className="tw:relative tw:flex tw:items-center tw:gap-1">
      {/* Previous navigation arrow */}
      <button
        aria-label="Previous token"
        className="tw:icon-button"
        disabled={atStart}
        tabIndex={-1}
        onClick={stepPrev}
        type="button"
      >
        <span aria-hidden="true">{isRtl ? '\u2192' : '\u2190'}</span>
      </button>

      {/* Scrollable token strip */}
      <div
        data-testid="strip-scroll-viewport"
        ref={scrollViewportRef}
        className="tw:relative tw:flex-1"
        style={{ overflowX: 'hidden', overflowY: 'visible' }}
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
              onMouseLeave={() => {
                setHoveredPhraseId(undefined);
                clearHoverState();
              }}
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
      <button
        aria-label="Next token"
        className="tw:icon-button"
        disabled={atEnd}
        tabIndex={-1}
        onClick={stepNext}
        type="button"
      >
        <span aria-hidden="true">{isRtl ? '\u2190' : '\u2192'}</span>
      </button>
    </div>
  );
}
