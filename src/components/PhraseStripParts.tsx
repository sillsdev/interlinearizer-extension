/** @file Shared render parts for the two phrase strips (SegmentView and ContinuousView). */
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from '../types/phrase-mode';
import { MemoizedInertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import { ARC_BASE_STEM, ARC_CORNER_RADIUS, ARC_LEVEL_STEP } from '../utils/phrase-arc';
import {
  resolveSlotFocus,
  type FocusContext,
  type LinkSlot,
  type TokenGroup,
} from '../utils/token-layout';

/**
 * Computes whether a phrase group should render highlighted, with identical rules in both views.
 *
 * In `view` mode a group is highlighted when its phrase is the one hovered anywhere, when its
 * phrase is the focused phrase (so all discontiguous fragments group visually with the focused
 * box), or when any of its tokens is a candidate for a hovered link. In `edit`/`confirm-unlink`
 * mode only the group belonging to the active mode phrase is highlighted; other phrases are never
 * highlighted.
 *
 * @param phraseMode - Current phrase-interaction mode.
 * @param phraseId - The group's phraseId, or `undefined` for a solo token.
 * @param group - The phrase group being rendered.
 * @param hoveredPhraseId - PhraseId currently hovered anywhere in the view.
 * @param focusedPhraseId - PhraseId of the focused token's phrase, or `undefined`.
 * @param candidateTokenRefs - Token refs a hovered link icon would join into a new phrase.
 * @returns `true` when the group should render with the highlighted style.
 */
export function resolveIsHighlighted(
  phraseMode: PhraseMode,
  phraseId: string | undefined,
  group: TokenGroup,
  hoveredPhraseId: string | undefined,
  focusedPhraseId: string | undefined,
  candidateTokenRefs: ReadonlySet<string>,
): boolean {
  if (phraseMode.kind === 'view') {
    if (phraseId !== undefined && phraseId === hoveredPhraseId) return true;
    // Highlight all boxes of the focused phrase, even when not directly hovered, so discontiguous
    // fragments are visually grouped with the focused box.
    if (phraseId !== undefined && phraseId === focusedPhraseId) return true;
    if (group.tokens.some((t) => candidateTokenRefs.has(t.ref))) return true;
    return false;
  }
  return phraseId !== undefined && phraseId === phraseMode.phraseId;
}

/** Props for {@link PhraseSlot}. */
type PhraseSlotProps = Readonly<{
  /** The between-group slot to render: its neighboring groups and any punctuation in the gap. */
  slot: LinkSlot;
  /** Resolved focus context shared by both views; supplies the link-icon's focus inputs. */
  focus: FocusContext;
  /** Segment id of the group before the slot, or `undefined` for the leading slot. */
  prevSegmentId: string | undefined;
  /** Segment id of the group after the slot, or `undefined` for the trailing slot. */
  nextSegmentId: string | undefined;
  /**
   * `true` when the focused group is start-ward of this slot, `false` when end-ward, `undefined`
   * when nothing is focused. Pre-computed by each parent from its own ordering.
   */
  focusedSideIsPrev: boolean | undefined;
  /** PhraseId currently hovered anywhere; used to reveal the in-phrase unlink icon. */
  hoveredPhraseId: string | undefined;
}>;

/**
 * Renders one between-group slot: the link/unlink icon plus any punctuation tokens that sit in the
 * gap. Pure — both views feed it identical inputs so the slot renders the same in either layout.
 * The link icon's phrase mode, document-order lookup, and hover callbacks come from
 * {@link PhraseStripContext}.
 *
 * @param props - Component props
 * @param props.slot - The slot's neighboring groups and gap punctuation
 * @param props.focus - Resolved focus context for the link icon's focus inputs
 * @param props.prevSegmentId - Segment id of the group before the slot
 * @param props.nextSegmentId - Segment id of the group after the slot
 * @param props.focusedSideIsPrev - Whether focus is start-ward of this slot
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the view
 * @returns A `link-slot` span containing the link icon and punctuation chips, or `undefined` when
 *   the slot has nothing to render (no neighbors and no punctuation).
 */
export function PhraseSlot({
  slot,
  focus,
  prevSegmentId,
  nextSegmentId,
  focusedSideIsPrev,
  hoveredPhraseId,
}: PhraseSlotProps) {
  const { prevGroup, nextGroup, punctuation } = slot;
  if (!prevGroup && !nextGroup && punctuation.length === 0) return undefined;
  const prevToken = prevGroup?.tokens[prevGroup.tokens.length - 1];
  const nextToken = nextGroup?.tokens[0];
  const prevPhraseId = prevGroup?.phraseLink?.analysisId;
  const nextPhraseId = nextGroup?.phraseLink?.analysisId;
  const phraseRevealed =
    prevPhraseId !== undefined &&
    prevPhraseId === nextPhraseId &&
    (prevPhraseId === hoveredPhraseId || prevPhraseId === focus.focusedPhraseId);
  // focusedSideIsPrev is precomputed per slot by the parent, so it always agrees with
  // focus.focusedFreeToken / focus.focusedPhraseLink. The link button's direction and target
  // therefore can never disagree.
  const slotFocus = resolveSlotFocus(prevSegmentId, nextSegmentId, focus, focusedSideIsPrev);
  return (
    <span className="tw:link-slot">
      <MemoizedTokenLinkIcon
        slotFocus={slotFocus}
        isPhraseRevealed={phraseRevealed}
        nextPhraseLink={nextGroup?.phraseLink}
        nextToken={nextToken}
        prevPhraseLink={prevGroup?.phraseLink}
        prevToken={prevToken}
      />
      {punctuation.map((punctToken) => (
        <MemoizedInertTokenChip key={punctToken.ref} token={punctToken} />
      ))}
    </span>
  );
}

/** Props for {@link PhraseGroup}. */
type PhraseGroupProps = Readonly<{
  /** The phrase group to render as a `PhraseBox`. */
  group: TokenGroup;
  /** Whether this group is the current navigation focus (computed by the parent). */
  isFocused: boolean;
  /** Whether this group should render highlighted (computed by the parent). */
  isHighlighted: boolean;
  /** Token refs that would become free after a hovered split/unlink (computed by the parent). */
  splitFreeTokenRefs: ReadonlySet<string>;
  /** Whether the edit/unlink controls pill should show above this group. */
  showControls: boolean;
  /** Whether the phrase gloss input should show (false for non-first discontiguous fragments). */
  showGlossInput: boolean;
  /** Upward offset in px for the controls pill so it aligns with the arc top. */
  arcOffsetPx: number;
  /** Whether hover handlers are wired (only in view mode for real phrases). */
  allowHover: boolean;
  /** Called on pointer enter when `allowHover` is true. */
  onHoverEnter: () => void;
  /** Called on pointer leave when `allowHover` is true. */
  onHoverLeave: () => void;
  /** Called when this group's gloss input gains focus. */
  onFocusPhrase: () => void;
  /** Optional DOM-ref callback for the wrapper span; used by ContinuousView for scroll-into-view. */
  groupRef?: (el: HTMLSpanElement | null) => void;
}>;

/**
 * Renders one phrase group: the hover-wrapper span around a `MemoizedPhraseBox`. Pure — both views
 * feed it identical, pre-computed inputs so the box renders the same in either layout. The parent
 * owns all layout-specific math (focus highlighting, hover state, scroll refs) and passes the
 * results in; strip-wide state (phrase mode, edit context, hover callbacks) reaches the box through
 * {@link PhraseStripContext}.
 *
 * @param props - Component props
 * @param props.group - The phrase group to render
 * @param props.isFocused - Whether this group is the navigation focus
 * @param props.isHighlighted - Whether this group renders highlighted
 * @param props.splitFreeTokenRefs - Token refs in this group that preview as becoming free
 * @param props.showControls - Whether to show the controls pill
 * @param props.showGlossInput - Whether to show the gloss input
 * @param props.arcOffsetPx - Upward offset for the controls pill
 * @param props.allowHover - Whether hover handlers are wired
 * @param props.onHoverEnter - Pointer-enter handler
 * @param props.onHoverLeave - Pointer-leave handler
 * @param props.onFocusPhrase - Called when this group's gloss input gains focus
 * @param props.groupRef - Optional DOM-ref callback for the wrapper span
 * @returns A wrapper span containing the phrase box.
 */
export function PhraseGroup({
  group,
  isFocused,
  isHighlighted,
  splitFreeTokenRefs,
  showControls,
  showGlossInput,
  arcOffsetPx,
  allowHover,
  onHoverEnter,
  onHoverLeave,
  onFocusPhrase,
  groupRef,
}: PhraseGroupProps) {
  return (
    <span
      ref={groupRef}
      onMouseEnter={allowHover ? onHoverEnter : undefined}
      onMouseLeave={allowHover ? onHoverLeave : undefined}
    >
      <MemoizedPhraseBox
        arcOffsetPx={arcOffsetPx}
        isFocused={isFocused}
        isHighlighted={isHighlighted}
        splitFreeTokenRefs={splitFreeTokenRefs}
        onFocusPhrase={onFocusPhrase}
        phraseLink={group.phraseLink}
        showControls={showControls}
        showGlossInput={showGlossInput}
        tokens={group.tokens}
      />
    </span>
  );
}

/** Stable empty set passed to phrase boxes outside view mode so memoization isn't broken. */
const EMPTY_SPLIT_FREE_REFS: ReadonlySet<string> = new Set();

/**
 * A normalized item in a phrase strip: either a between-group slot or a phrase group, carrying only
 * the per-item data each view resolves differently. The shared {@link PhraseStrip} body owns
 * everything common to both views (highlight, controls, arc offset, hover wiring); the views supply
 * just these layout-specific fields.
 */
export type StripItem =
  | {
      kind: 'slot';
      /** Stable React key for this slot. */
      key: string;
      /** The slot's neighboring groups and gap punctuation. */
      slot: LinkSlot;
      /** Segment id of the group before the slot (views resolve this differently). */
      prevSegmentId: string | undefined;
      /** Segment id of the group after the slot. */
      nextSegmentId: string | undefined;
      /** Whether focus is start-ward of this slot, precomputed by the view. */
      focusedSideIsPrev: boolean | undefined;
    }
  | {
      kind: 'group';
      /** Stable React key for this group (its first token ref). */
      key: string;
      /** The phrase group to render. */
      group: TokenGroup;
      /** Whether this group is the navigation focus (views key this off different focus refs). */
      isFocused: boolean;
      /** Optional DOM-ref callback for the wrapper span; used by ContinuousView for scroll-in. */
      groupRef?: (el: HTMLSpanElement | null) => void;
    };

/** Props for {@link PhraseStrip}. */
type PhraseStripProps = Readonly<{
  /** The normalized, ordered strip items built by the calling view. */
  items: StripItem[];
  /** Current phrase-interaction mode; gates controls, split previews, and highlight rules. */
  phraseMode: PhraseMode;
  /** Resolved focus context shared by both views. */
  focus: FocusContext;
  /** PhraseId currently hovered anywhere in the view. */
  hoveredPhraseId: string | undefined;
  /** Group key (first token ref) of the currently hovered phrase box, or `undefined`. */
  hoveredGroupKey: string | undefined;
  /** Token refs a hovered link icon would join into a new phrase. */
  candidateTokenRefs: ReadonlySet<string>;
  /** Token refs that would become free after a hovered split/unlink. */
  splitFreeTokenRefs: ReadonlySet<string>;
  /** PhraseId → arc nesting level, used to lift the controls pill above stacked arcs. */
  arcLevelByPhraseId: ReadonlyMap<string, number>;
  /** Called with the phraseId (or `undefined`) when a phrase box is entered/left. */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Sets (or clears) the hovered group key when a phrase box is entered/left. */
  setHoveredGroupKey: (key: string | undefined) => void;
  /** Called with a group's first-token ref when its gloss input gains focus. */
  onFocusPhrase: (groupKey: string) => void;
}>;

/**
 * Renders a complete phrase strip from normalized {@link StripItem}s: the alternating sequence of
 * {@link PhraseSlot}s and {@link PhraseGroup}s, with all per-group derivations (gloss-input
 * deduplication, arc offset, highlight, controls visibility, hover handlers) computed here so both
 * views ({@link SegmentView}, {@link ContinuousView}) share one body and can never drift apart. Each
 * view supplies only the layout-specific fields baked into the items (segment ids, focus side,
 * focus ref, scroll refs).
 *
 * @param props - Component props
 * @param props.items - The normalized, ordered strip items
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.focus - Resolved focus context
 * @param props.hoveredPhraseId - PhraseId hovered anywhere in the view
 * @param props.hoveredGroupKey - Group key of the hovered phrase box
 * @param props.candidateTokenRefs - Token refs a hovered link would join
 * @param props.splitFreeTokenRefs - Token refs that would become free after a hovered split
 * @param props.arcLevelByPhraseId - PhraseId → arc nesting level
 * @param props.onHoverPhrase - Phrase-box enter/leave callback
 * @param props.setHoveredGroupKey - Hovered-group-key setter
 * @param props.onFocusPhrase - Gloss-input focus callback, by group key
 * @returns The strip's ordered slot and group elements.
 */
export function PhraseStrip({
  items,
  phraseMode,
  focus,
  hoveredPhraseId,
  hoveredGroupKey,
  candidateTokenRefs,
  splitFreeTokenRefs,
  arcLevelByPhraseId,
  onHoverPhrase,
  setHoveredGroupKey,
  onFocusPhrase,
}: PhraseStripProps) {
  const seenPhraseIds = new Set<string>();
  return items.map((item) => {
    if (item.kind === 'slot') {
      return (
        <PhraseSlot
          key={item.key}
          slot={item.slot}
          focus={focus}
          prevSegmentId={item.prevSegmentId}
          nextSegmentId={item.nextSegmentId}
          focusedSideIsPrev={item.focusedSideIsPrev}
          hoveredPhraseId={hoveredPhraseId}
        />
      );
    }
    const { group, key: groupKey } = item;
    const phraseId = group.phraseLink?.analysisId;
    const showGlossInput = phraseId === undefined || !seenPhraseIds.has(phraseId);
    if (phraseId !== undefined) seenPhraseIds.add(phraseId);
    const arcLevel = phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
    const arcOffsetPx =
      arcLevel > 0
        ? /* v8 ignore next -- arcLevel > 0 requires DOM layout, not available in jsdom */
          ARC_BASE_STEM + arcLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
        : 0;
    const isHighlighted = resolveIsHighlighted(
      phraseMode,
      phraseId,
      group,
      hoveredPhraseId,
      focus.focusedPhraseId,
      candidateTokenRefs,
    );
    return (
      <PhraseGroup
        key={groupKey}
        group={group}
        isFocused={item.isFocused}
        isHighlighted={isHighlighted}
        splitFreeTokenRefs={phraseMode.kind === 'view' ? splitFreeTokenRefs : EMPTY_SPLIT_FREE_REFS}
        showControls={
          phraseMode.kind === 'view' && phraseId !== undefined && groupKey === hoveredGroupKey
        }
        showGlossInput={showGlossInput}
        arcOffsetPx={arcOffsetPx}
        allowHover={phraseId !== undefined}
        onHoverEnter={() => {
          onHoverPhrase(phraseId);
          setHoveredGroupKey(groupKey);
        }}
        onHoverLeave={() => {
          onHoverPhrase(undefined);
          setHoveredGroupKey(undefined);
        }}
        onFocusPhrase={() => onFocusPhrase(groupKey)}
        groupRef={item.groupRef}
      />
    );
  });
}
