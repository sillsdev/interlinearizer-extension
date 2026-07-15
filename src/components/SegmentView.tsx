import { useLocalizedStrings } from '@papi/frontend/react';
import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import { useArcPaths } from '../hooks/useArcPaths';
import { usePhraseHoverState } from '../hooks/usePhraseHoverState';
import {
  useArcSplitHandler,
  useCandidatePhraseIds,
  useEditPhraseTokens,
  usePhraseStripContextValue,
} from '../hooks/usePhraseStripSetup';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import type { RenderUnit } from '../types/token-layout';
import { isWordToken } from '../types/type-guards';
import { buildRenderUnits, groupTokens, resolveFocusContext } from '../utils/token-layout';
import { resolveSplitAnchor } from '../utils/split-anchor';
import { usePhraseLinkByIdMap, usePhraseLinkMap } from './AnalysisStore';
import { useAltHeldValue } from './AltHeldContext';
import MemoizedArcOverlay from './ArcOverlay';
import SegmentFreeTranslationInput from './SegmentFreeTranslationInput';
import { PhraseStripProvider } from './PhraseStripContext';
import { PhraseStrip, VerseSuperscript, type StripItem } from './PhraseStripParts';
import { useSegmentation } from './SegmentationStore';

/**
 * The two display modes for {@link SegmentView}.
 *
 * - `token-chip` — renders each token as an inline chip (word tokens via `PhraseBox`, punctuation via
 *   `TokenChip`). Used for the main interactive view.
 * - `baseline-text` — renders the segment's raw `baselineText` as a single monospace string. Used for
 *   fallback or debug display.
 */
export type SegmentDisplayMode = 'token-chip' | 'baseline-text';

/**
 * Localized string keys this view needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders. A fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render, which (with one SegmentView per verse) escalates
 * into an infinite update loop that freezes the WebView.
 */
const STRING_KEYS = [
  '%interlinearizer_linkButton_crossSegmentDisabledTooltip%',
  '%interlinearizer_boundaryControl_split%',
] as const satisfies `%${string}%`[];

/**
 * One piece of the baseline-text render: a verbatim text run, an inline verse superscript, or a
 * splittable gap. Concatenating every piece's `text` (superscripts contribute none) reproduces the
 * segment's `baselineText` byte-for-byte.
 */
type BaselinePiece =
  | {
      kind: 'text';
      /** Stable React key derived from this piece's char offset. */
      key: string;
      /** A verbatim slice of `baselineText`. */
      text: string;
    }
  | {
      kind: 'gap';
      /** Stable React key derived from this piece's char offset. */
      key: string;
      /** The verbatim inter-token gap slice of `baselineText`. */
      text: string;
      /** The split anchor ref an Alt+click here dispatches. */
      splitRef: string;
    }
  | {
      kind: 'superscript';
      /** Stable React key derived from this piece's char offset. */
      key: string;
      /** The verse label to render as a superscript at this position. */
      label: string;
    };

/**
 * Builds the ordered baseline-text render pieces for a segment. Partitions `baselineText` at every
 * token boundary, verse-start offset, and split-gap end so each slice can be rendered as its own
 * span; the partition is exhaustive, so concatenating the slices reproduces `baselineText` exactly
 * (no whitespace or punctuation is dropped). A verse superscript is emitted at each verse-start
 * offset, and the gap slice ending immediately before a split anchor is marked splittable.
 *
 * @param segment - The segment whose baseline text is being laid out.
 * @param verseStartLabelByOffset - Char offset → verse superscript label.
 * @param splitGapByOffset - Anchor char offset → split anchor ref; the gap slice ending at that
 *   offset becomes the splittable gap.
 * @returns The ordered baseline pieces.
 */
function buildBaselinePieces(
  segment: Segment,
  verseStartLabelByOffset: ReadonlyMap<number, string>,
  splitGapByOffset: ReadonlyMap<number, string>,
): BaselinePiece[] {
  const { baselineText, tokens } = segment;
  // Every offset at which the text must be cut into its own span: string ends, token edges, verse
  // starts, and split-anchor starts. Sorted and de-duplicated so the walk visits each once.
  const cuts = new Set<number>([0, baselineText.length]);
  tokens.forEach((t) => {
    cuts.add(t.charStart);
    cuts.add(t.charEnd);
  });
  verseStartLabelByOffset.forEach((_label, offset) => cuts.add(offset));
  splitGapByOffset.forEach((_ref, offset) => cuts.add(offset));
  const sortedCuts = [...cuts].sort((a, b) => a - b);

  const pieces: BaselinePiece[] = [];
  for (let i = 0; i < sortedCuts.length; i += 1) {
    const start = sortedCuts[i];
    const label = verseStartLabelByOffset.get(start);
    if (label !== undefined) pieces.push({ kind: 'superscript', key: `sup-${start}`, label });
    const end = sortedCuts[i + 1];
    if (end === undefined) break;
    const text = baselineText.slice(start, end);
    const splitRef = splitGapByOffset.get(end);
    const key = `piece-${start}`;
    if (splitRef !== undefined) pieces.push({ kind: 'gap', key, text, splitRef });
    else pieces.push({ kind: 'text', key, text });
  }
  return pieces;
}

/** Props for {@link SegmentView}. */
type SegmentViewProps = Readonly<{
  /** Controls whether tokens are rendered as chips or as raw baseline text. */
  displayMode: SegmentDisplayMode;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref of the word token that should appear focused; `undefined` clears focus. */
  focusedTokenRef: string | undefined;
  /** Whether this segment corresponds to the currently active verse. */
  isActive: boolean;
  /**
   * Called when the segment or one of its word tokens is selected. In `baseline-text` mode the
   * whole segment is clickable and selecting it passes the segment's first word token (so the
   * segment gains focus and the active highlight); in `token-chip` mode only word tokens trigger
   * this and `tokenRef` is the clicked token. `tokenRef` is omitted only when the segment has no
   * word token to anchor on.
   */
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  /** The segment to render. */
  segment: Segment;
  /**
   * Render label for each of the segment's `verseStarts`, parallel by index — the inline
   * verse-superscript string, chapter-qualified (`chapter:number`) by the list at a chapter
   * transition and bare otherwise. Omitted (or a missing entry) falls back to the verbatim
   * `verseStarts[i].number`, since only the list has the cross-segment context to qualify.
   */
  verseStartLabels?: readonly string[];
  /** Current phrase-interaction mode; controls token click behavior and disabled state. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /**
   * The phraseId currently hovered anywhere in the interlinearizer. When set, phrase boxes matching
   * this id are highlighted even if the pointer is over a different segment.
   */
  hoveredPhraseId: string | undefined;
  /** Called when the pointer enters or leaves a phrase box; passes the phraseId or `undefined`. */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Token ref → segment id lookup; passed through to `PhraseBox` for segment-scope edit. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → flat book-level index; used to sort phrase tokens in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Word token ref → token lookup for the whole book; used to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * Bundled display toggles; `showFreeTranslation` gates the free-translation input, while the rest
   * pass through to {@link PhraseStripContextValue}.
   */
  viewOptions: ViewOptions;
}>;

/**
 * Renders a single segment as either inline token chips or plain baseline text.
 *
 * @param props - Component props
 * @param props.displayMode - Controls how segment content is rendered
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited; used to disable
 *   cross-segment selection.
 * @param props.focusedTokenRef - When set, the matching word token's `PhraseBox` is rendered in the
 *   focused state; only meaningful in `token-chip` mode.
 * @param props.isActive - Whether this segment is the currently selected verse
 * @param props.onSelect - Required callback invoked when the segment or one of its word tokens is
 *   interacted with. In `baseline-text` mode the whole segment is clickable and selecting it passes
 *   the segment's first word token; in `token-chip` mode only word tokens trigger this callback
 *   with the clicked token. `tokenRef` is omitted only when the segment has no word token.
 * @param props.segment - The segment to render
 * @param props.verseStartLabels - Per-verse-start inline superscript labels (parallel to
 *   `segment.verseStarts`), chapter-qualified by the list where a verse start opens a new chapter;
 *   falls back to the verbatim verse number when absent.
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the interlinearizer
 * @param props.onHoverPhrase - Called with the phraseId when the pointer enters a phrase box, or
 *   `undefined` when it leaves
 * @param props.tokenSegmentMap - Token ref → segment id lookup; passed through to `PhraseBox` for
 *   segment-scope edit.
 * @param props.tokenDocOrder - Book-level map from word token ref to flat document index; used to
 *   sort phrase tokens across segment boundaries.
 * @param props.wordTokenByRef - Word token ref → token lookup; used to resolve focus context.
 * @param props.viewOptions - Bundled display toggles; `showFreeTranslation` gates the
 *   free-translation input, while the rest pass through to the phrase strip context.
 * @returns A div containing the segment content (baseline text or token chips) with inline verse
 *   superscripts
 */
export function SegmentView({
  displayMode,
  editPhraseSegmentId,
  focusedTokenRef,
  isActive,
  onSelect,
  segment,
  verseStartLabels,
  phraseMode,
  setPhraseMode,
  hoveredPhraseId,
  onHoverPhrase,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
  viewOptions,
}: SegmentViewProps) {
  const { hideInactiveLinkButtons, simplifyPhrases, showMorphology, showFreeTranslation } =
    viewOptions;
  const { book, chapter, verse } = segment.startRef;
  const ref: ScriptureRef = useMemo(() => ({ book, chapter, verse }), [book, chapter, verse]);

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const { dispatch, formerBoundaries, straddledBoundaryRefs } = useSegmentation();
  const altHeld = useAltHeldValue();

  const phraseLinkByRef = usePhraseLinkMap();
  const phraseLinkById = usePhraseLinkByIdMap();

  /** Bridges an {@link ArcOverlay} split-button click into the phrase-store split dispatch. */
  const handleArcSplit = useArcSplitHandler(tokenDocOrder);

  /**
   * Forwards a token-chip click (identified by the group's first-token ref) to the parent as a
   * scripture reference + token id. Stable across renders so `MemoizedPhraseBox` can memoize.
   *
   * @param tokenRef - Ref of the group's first token, supplied by `PhraseBox`.
   */
  const handleTokenClick = useCallback(
    (tokenRef?: string) => {
      if (tokenRef !== undefined) onSelect(ref, tokenRef);
    },
    [onSelect, ref],
  );

  /** Groups of adjacent same-phrase tokens (or solo tokens) for rendering as `PhraseBox`es. */
  const tokenGroups = useMemo(
    () => groupTokens(segment.tokens, phraseLinkByRef),
    [segment.tokens, phraseLinkByRef],
  );

  // Both states carry a real border so activating a segment only recolors it — never adds or removes
  // one, which would change the segment's height by 2px and shift every segment below it (a visible
  // jump in the list whenever the active verse moves on a click). The inactive border is a faint
  // (`border-border/40`) always-visible outline so each segment reads as its own card now that the
  // between-row rail is inert until Alt is held; activating brightens it to the full `border-border`.
  const sharedClassName = isActive
    ? 'tw:w-full tw:rounded tw:border tw:border-border tw:bg-muted/50 tw:p-2'
    : 'tw:w-full tw:rounded tw:border tw:border-border/40 tw:p-2 tw:transition-colors tw:hover:bg-muted/30';

  /**
   * Resolved inline superscript label for each of the segment's verse starts: the list-supplied
   * `verseStartLabels` entry (chapter-qualified where a verse start opens a new chapter) or, absent
   * that, the verbatim verse number carried on the verse start itself.
   */
  const resolvedVerseStartLabels = useMemo(
    () => segment.verseStarts.map((vs, i) => verseStartLabels?.[i] ?? vs.number),
    [segment.verseStarts, verseStartLabels],
  );

  /**
   * Verse-start char offset → resolved superscript label, so the baseline-text walk can emit a
   * superscript wherever a verse begins.
   */
  const verseStartLabelByOffset = useMemo(() => {
    const map = new Map<number, string>();
    segment.verseStarts.forEach((vs, i) => map.set(vs.charStart, resolvedVerseStartLabels[i]));
    return map;
  }, [segment.verseStarts, resolvedVerseStartLabels]);

  /**
   * Split anchor by the char offset of the gap that precedes it, for baseline-text mode: for each
   * eligible word-word pair the punctuation-travel anchor's leading gap (the inter-token region
   * just before the anchor token) becomes a splittable gap. A pair is eligible only in `view` mode
   * and only when its word boundary is not a mid-phrase (straddled) boundary — the same rules the
   * token-chip marker uses. A split at a former boundary dispatches the original removed default
   * start (which may be leading punctuation) so the delta can normalize back to the default
   * segmentation; otherwise the anchor comes from the punctuation-travel rule. The `altHeld` gate
   * is applied at render time, not here, so this map stays stable across Alt presses.
   */
  const splitGapByOffset = useMemo(() => {
    const map = new Map<number, string>();
    if (phraseMode.kind !== 'view') return map;
    const { tokens, baselineText } = segment;
    let prevWord: Token | undefined;
    let pendingPunct: Token[] = [];
    tokens.forEach((token) => {
      if (!isWordToken(token)) {
        pendingPunct.push(token);
        return;
      }
      if (prevWord !== undefined && !straddledBoundaryRefs.has(token.ref)) {
        const anchor = resolveSplitAnchor(prevWord, token, pendingPunct, baselineText);
        const anchorToken =
          anchor === token.ref ? token : pendingPunct.find((p) => p.ref === anchor);
        /* v8 ignore next -- resolveSplitAnchor always returns the next word or a gap punctuation ref */
        if (anchorToken !== undefined) {
          map.set(anchorToken.charStart, formerBoundaries.get(token.ref) ?? anchor);
        }
      }
      prevWord = token;
      pendingPunct = [];
    });
    return map;
  }, [segment, phraseMode.kind, straddledBoundaryRefs, formerBoundaries]);

  /**
   * The ordered baseline-text render pieces: plain-text runs, inline verse superscripts, and
   * splittable gaps. Slices are taken verbatim from `baselineText` (token surfaces, inter-token
   * gaps, and any leading/trailing text a token does not cover), so concatenating every piece's
   * text reproduces `baselineText` byte-for-byte — the only visible additions are the verse
   * superscripts, exactly as before. A gap whose starting offset is a split anchor carries its
   * `splitRef` so an Alt+click there can dispatch the split.
   */
  const baselinePieces = useMemo<BaselinePiece[]>(
    () => buildBaselinePieces(segment, verseStartLabelByOffset, splitGapByOffset),
    [segment, verseStartLabelByOffset, splitGapByOffset],
  );

  /**
   * Splits the segment at the given anchor when the click carries the Alt modifier; a plain click
   * falls through to {@link handleBaselineClick} (which selects the segment). Keeps the gesture
   * Alt-only so it never fights the plain-click select/focus behavior.
   *
   * @param event - The click event on the split gap.
   * @param splitRef - The resolved split anchor ref to dispatch.
   */
  const handleBaselineGapClick = useCallback(
    (event: MouseEvent, splitRef: string) => {
      if (!event.altKey) return;
      event.stopPropagation();
      dispatch.split(splitRef);
    },
    [dispatch],
  );

  /**
   * `false` until just after the first paint, then `true`. Gates the link-slot fade transition: the
   * initial visibility state must snap into place before paint (fading in on mount would flash),
   * but every later flip of `isActive` / `hideInactiveLinkButtons` should animate.
   */
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  /**
   * Ref to the outer `tw:relative tw:overflow-visible` div that is both the SVG parent and the arc
   * measurement container. Using this element (rather than the inner token-row span) aligns the
   * coordinate origin with the SVG's `inset: 0` anchor, so arc y-positions are always correct.
   */
  // eslint-disable-next-line no-null/no-null
  const arcContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Hover-preview state shared with ContinuousView: the hovered group key (controls float above
   * whichever fragment the pointer is over), link-candidate token refs, and would-become-free token
   * refs, plus their stable handlers.
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
    onHoverPhrase(undefined);
    clearHoverState();
  }, [onHoverPhrase, clearHoverState]);

  const candidatePhraseIds = useCandidatePhraseIds(candidateTokenRefs, phraseLinkByRef);

  /**
   * Resolved focus context — what's focused, what segment it's in, what phrase it belongs to. Built
   * once from `focusedTokenRef` and reused by all highlight + slot decisions so the rules match
   * ContinuousView exactly.
   */
  const focus = useMemo(
    () => resolveFocusContext(focusedTokenRef, wordTokenByRef, phraseLinkByRef, tokenSegmentMap),
    [focusedTokenRef, wordTokenByRef, phraseLinkByRef, tokenSegmentMap],
  );

  /** Render units (groups + slots) for this segment. */
  const renderUnits = useMemo(
    () => buildRenderUnits(segment.tokens, tokenGroups),
    [segment.tokens, tokenGroups],
  );

  /**
   * Per-slot `focusedSideIsPrev`, precomputed once by walking the render units in document order. A
   * slot's value is `true` once the focused group has been seen (focus is start-ward of the slot),
   * `false` before it (focus is end-ward), and `undefined` when nothing is focused. Keyed by render
   * unit so the render body can look it up instead of threading a cursor through the map.
   */
  const focusedSideIsPrevByUnit = useMemo(() => {
    const map = new Map<RenderUnit, boolean | undefined>();
    let focusedGroupSeen = false;
    renderUnits.forEach((unit) => {
      if (unit.kind === 'group') {
        if (unit.group.tokens.some((t) => t.ref === focusedTokenRef)) focusedGroupSeen = true;
      } else {
        map.set(unit, focusedTokenRef === undefined ? undefined : focusedGroupSeen);
      }
    });
    return map;
  }, [renderUnits, focusedTokenRef]);

  /**
   * Verse-start token ref → resolved verse label. The verse-start token is the segment token whose
   * `charStart` matches a verse start; keying by ref lets the strip builder mark the slot that
   * begins each verse — the slot before the verse's first group, or (for a verse opening on leading
   * punctuation) the slot that carries that punctuation — so {@link PhraseSlot} can render the verse
   * number below the link icon.
   */
  const verseStartLabelByTokenRef = useMemo(() => {
    const map = new Map<string, string>();
    segment.verseStarts.forEach((vs, i) => {
      const startToken = segment.tokens.find((t) => t.charStart === vs.charStart);
      if (startToken) map.set(startToken.ref, resolvedVerseStartLabels[i]);
    });
    return map;
  }, [segment.verseStarts, segment.tokens, resolvedVerseStartLabels]);

  /**
   * Normalized strip items handed to the shared {@link PhraseStrip} body. Each slot carries the
   * verse label when a verse begins at it (its following group's first token, or one of its own gap
   * punctuation tokens, is a verse start); the shared {@link PhraseSlot} renders that number below
   * the link icon so both strips mark verse boundaries identically. Both slot neighbors are in this
   * segment by construction (one segment per render), so both slot segment ids are `segment.id`.
   */
  const stripItems = useMemo<StripItem[]>(
    () =>
      renderUnits.map((unit) => {
        if (unit.kind === 'group') {
          return {
            kind: 'group',
            key: unit.group.tokens[0].ref,
            group: unit.group,
            isFocused: unit.group.tokens.some((t) => t.ref === focusedTokenRef),
          };
        }
        const { prevGroup, nextGroup, punctuation } = unit.slot;
        const key = `slot-${prevGroup?.tokens[prevGroup.tokens.length - 1]?.ref ?? 'start'}-${nextGroup?.tokens[0]?.ref ?? 'end'}`;
        // The slot begins a verse when the verse's first token renders next through it: the following
        // group's first token, or (for a verse opening on leading punctuation) a token in this slot's
        // gap punctuation.
        const verseStartRef =
          [nextGroup?.tokens[0]?.ref, ...punctuation.map((p) => p.ref)].find(
            (tokenRef) => tokenRef !== undefined && verseStartLabelByTokenRef.has(tokenRef),
          ) ?? undefined;
        const verseLabel =
          verseStartRef !== undefined ? verseStartLabelByTokenRef.get(verseStartRef) : undefined;
        return {
          kind: 'slot',
          key,
          slot: unit.slot,
          prevSegmentId: segment.id,
          nextSegmentId: segment.id,
          focusedSideIsPrev: focusedSideIsPrevByUnit.get(unit),
          verseLabel,
        };
      }),
    [renderUnits, segment.id, focusedSideIsPrevByUnit, focusedTokenRef, verseStartLabelByTokenRef],
  );

  const editPhraseTokens = useEditPhraseTokens(phraseMode);

  /**
   * Strip-wide context value shared by every phrase group and link slot in this segment.
   * `onHoverPhrase` doubles as the candidate-phrase hover callback. The active segment is this
   * segment only while it is the active verse; the link-slot transition is suppressed until just
   * after first paint so the initial state snaps in without a flash.
   */
  const stripContext = usePhraseStripContextValue({
    phraseMode,
    setPhraseMode,
    editPhraseTokens,
    editPhraseSegmentId,
    tokenSegmentMap,
    tokenDocOrder,
    onHoverPhrase,
    onHoverCandidateTokens: setCandidateTokenRefs,
    onHoverSplitFreeTokens: handleHoverSplitFreeTokens,
    hideInactiveLinkButtons,
    simplifyPhrases,
    activeSegmentId: isActive ? segment.id : undefined,
    crossSegmentLinkTooltip:
      localizedStrings['%interlinearizer_linkButton_crossSegmentDisabledTooltip%'],
    skipLinkTransition: !hasMounted,
    showMorphology,
  });

  /** True when any committed phrase exists in this segment. */
  const hasRealPhraseInSegment = tokenGroups.some((g) => g.phraseLink !== undefined);

  /**
   * Ref of the first word token in this segment, used to focus its phrase when the background is
   * clicked.
   */
  const firstWordTokenRef = useMemo(
    () => segment.tokens.find((t) => t.type === 'word')?.ref,
    [segment.tokens],
  );

  /**
   * Brings this segment's first phrase into focus and updates the active verse when the click lands
   * on segment background or structural wrappers rather than a genuinely interactive element. The
   * token row and arc container fill most of the segment, so a strict `target === currentTarget`
   * check would only catch the thin padding ring; instead we ignore the click only when it
   * originated inside an interactive element (token button, gloss input, etc.) or anywhere inside a
   * phrase box, each of which handles its own selection. The `label` and `[data-phrase-box]` cases
   * matter for clicks that land on a token chip's surrounding `<label>` or its surface-text span
   * rather than directly on the gloss input: those targets are not in the interactive-tag list, but
   * the browser still forwards the click to the chip's input (firing its own phrase focus), so the
   * background handler must not also fire and override that focus with the segment's first phrase —
   * which was most visible when clicking an out-of-segment phrase fragment. The `[data-link-slot]`
   * case is the inter-phrase link slot: when its link button is visible the button absorbs the
   * click, but when `hideInactiveLinkButtons` hides the button in place the slot becomes an empty
   * clickable gap between phrases. Treating it as background was the bug where clicking near a
   * phrase in an inactive segment (buttons hidden) snapped focus to the segment's first phrase;
   * ignoring it leaves the click a no-op, matching the buttons-visible behavior. Everything else —
   * padding, arc gutters, empty wrap space — focuses the first phrase.
   *
   * @param event - The click event on the segment container.
   */
  const handleBackgroundClick = useCallback(
    (event: MouseEvent) => {
      if (firstWordTokenRef === undefined) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, a, input, textarea, select, label, [contenteditable="true"], [data-phrase-box], [data-link-slot]',
        )
      ) {
        return;
      }
      onSelect(ref, firstWordTokenRef);
    },
    [firstWordTokenRef, onSelect, ref],
  );

  /**
   * Makes this segment the active verse when the free-translation input gains focus, so editing a
   * segment's translation behaves like selecting it. A no-op when the segment has no word token to
   * anchor the selection on.
   */
  const handleFreeTranslationFocus = useCallback(() => {
    if (firstWordTokenRef !== undefined) onSelect(ref, firstWordTokenRef);
  }, [firstWordTokenRef, onSelect, ref]);

  /**
   * Selects this segment when its baseline-text body is clicked, focusing its first word token so
   * the segment gains focus (and the active highlight) even when it is verse 0 — a superscription
   * that cannot be written back to the host as the active verse, and so would otherwise never
   * become active from a bare-ref select. Clicks that originate inside the free-translation input
   * are ignored: that input fires its own {@link handleFreeTranslationFocus} on focus, so letting
   * the container also fire would double-select the verse.
   *
   * @param event - The click event on the baseline-text container.
   */
  const handleBaselineClick = useCallback(
    (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('input')) return;
      onSelect(ref, firstWordTokenRef);
    },
    [firstWordTokenRef, onSelect, ref],
  );

  // Measure phrase boxes inside this segment and compute arcs. Disabled in baseline-text mode,
  // where the arc container is unmounted, so the result resets to empty.
  const {
    arcPaths,
    stripTopPadding: tokenRowTopPadding,
    stripRowGap,
    stripLeftPadding,
    stripRightPadding,
  } = useArcPaths(arcContainerRef, displayMode !== 'baseline-text', hasRealPhraseInSegment, [
    tokenGroups,
    phraseMode,
    displayMode,
    isActive,
    hideInactiveLinkButtons,
  ]);

  if (displayMode === 'baseline-text') {
    // Intentional: baseline-text mode renders a clickable div, not a button, so the
    // free-translation input can sit inside the same box (an input may not be nested in a button).
    // The free-translation input is the only interactive child and handles its own focus, so the
    // container only needs a click handler; a redundant key handler / role / tabIndex would add a
    // non-functional tab stop, so the relevant a11y rules are disabled here (matching token-chip
    // mode below).
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        aria-current={isActive ? 'true' : undefined}
        className={`${sharedClassName} tw:text-left`}
        data-segment-id={segment.id}
        data-testid="segment-container"
        onClick={handleBaselineClick}
      >
        <span className="tw:block tw:font-mono tw:text-sm tw:text-foreground">
          {baselinePieces.map((piece) => {
            if (piece.kind === 'superscript') {
              return <VerseSuperscript key={piece.key} label={piece.label} />;
            }
            // A splittable gap becomes an Alt-clickable marker only while Alt is held; otherwise it
            // renders as its plain text so the baseline reads byte-for-byte identically. Unlike the
            // token-chip / continuous strip (which have room for a `Split` glyph in their between-box
            // slots), an icon dropped into a monospace inter-word space just collides with the
            // letters. So on Alt-hold every eligible gap gets a tint plus a slim vertical insertion
            // caret shown dimly at rest — a discoverable map of where a split can land — and the
            // hovered gap brightens both to full strength so the pointed-at split point stands out.
            // The verbatim gap text stays as the span's content (same width — no reflow when Alt is
            // pressed); the caret is absolutely positioned so it adds no width and never pushes the
            // surrounding text around.
            if (piece.kind === 'gap' && altHeld) {
              const { splitRef } = piece;
              return (
                // Keyboard split is out of scope, so this is a pointer-only affordance (matching the
                // segment container's own click handler); the a11y lint rules are disabled here.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <span
                  key={piece.key}
                  className="tw:group/split tw:relative tw:cursor-pointer tw:rounded tw:bg-accent/30 tw:hover:bg-accent/60"
                  data-testid="baseline-split-gap"
                  title={localizedStrings['%interlinearizer_boundaryControl_split%']}
                  onClick={(event) => handleBaselineGapClick(event, splitRef)}
                >
                  {piece.text}
                  <span
                    aria-hidden="true"
                    className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:left-1/2 tw:w-px tw:-translate-x-1/2 tw:bg-muted-foreground tw:opacity-40 tw:transition-all tw:group-hover/split:bg-foreground tw:group-hover/split:opacity-100"
                    data-testid="baseline-split-caret"
                  />
                </span>
              );
            }
            return <Fragment key={piece.key}>{piece.text}</Fragment>;
          })}
        </span>
        {showFreeTranslation && (
          <SegmentFreeTranslationInput
            segmentId={segment.id}
            surfaceText={segment.baselineText}
            onFocus={handleFreeTranslationFocus}
          />
        )}
      </div>
    );
  }

  // Intentional: token-chip mode renders a div, not a button. In this mode individual word tokens
  // (via PhraseBox gloss inputs) are the interactive elements; the background click below only
  // focuses the first phrase, which keyboard users reach through those token elements directly. A
  // redundant key handler / role / tabIndex on the container would add a non-functional tab stop, so
  // the click-events-have-key-events and no-static-element-interactions rules are disabled here.
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      aria-current={isActive ? 'true' : undefined}
      className={sharedClassName}
      data-segment-id={segment.id}
      data-testid="segment-container"
      onClick={handleBackgroundClick}
    >
      <div className="tw:arc-container" ref={arcContainerRef}>
        <MemoizedArcOverlay
          arcPaths={arcPaths}
          phraseMode={phraseMode}
          hoveredPhraseId={hoveredPhraseId}
          focusedPhraseId={focus.focusedPhraseId}
          candidatePhraseIds={candidatePhraseIds}
          phraseLinkById={phraseLinkById}
          tokenDocOrder={tokenDocOrder}
          onArcSplit={handleArcSplit}
          onSplitHoverChange={handleSplitHoverChange}
          onHoverPhrase={onHoverPhrase}
          simplifyPhrases={simplifyPhrases}
        />
        <PhraseStripProvider value={stripContext}>
          <span
            className="tw:token-row tw:pointer-events-none"
            style={{
              paddingTop: `${tokenRowTopPadding}px`,
              paddingLeft: `${stripLeftPadding}px`,
              paddingRight: `${stripRightPadding}px`,
              rowGap: `${stripRowGap}px`,
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
              onHoverPhrase={onHoverPhrase}
              setHoveredGroupKey={setHoveredGroupKey}
              onFocusPhrase={handleTokenClick}
            />
          </span>
        </PhraseStripProvider>
      </div>
      {showFreeTranslation && (
        <SegmentFreeTranslationInput
          segmentId={segment.id}
          surfaceText={segment.baselineText}
          onFocus={handleFreeTranslationFocus}
        />
      )}
    </div>
  );
}

/** Memoized version of {@link SegmentView}; use in render-stable segment lists. */
const MemoizedSegmentView = memo(SegmentView);
export default MemoizedSegmentView;
