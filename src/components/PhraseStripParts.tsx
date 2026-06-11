/** @file Shared render parts for the two phrase strips (SegmentView and ContinuousView). */
import { memo } from 'react';
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from '../types/phrase-mode';
import { usePhraseStripContext } from './PhraseStripContext';
import { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import type { FocusContext, LinkSlot, TokenGroup } from '../types/token-layout';
import { resolveSlotFocus } from '../utils/token-layout';

/**
 * Duration, in milliseconds, of the link-slot opacity fade transition. Exported so `ContinuousView`
 * can re-center the focused phrase for exactly this long after `committedActiveSegmentId` flips,
 * keeping it anchored while the fade runs.
 */
export const LINK_SLOT_TRANSITION_MS = 200;

// #region PhraseSlot

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
  const { hideInactiveLinkButtons, activeSegmentId, skipLinkTransition } = usePhraseStripContext();
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
  const slotFocus = resolveSlotFocus(prevSegmentId, nextSegmentId, focus, focusedSideIsPrev);
  // The slot is "in the active segment" only when both neighboring phrases belong to it. A link
  // that crosses a verse boundary (one side in the active verse, the other in an adjacent verse) is
  // therefore treated as inactive and hidden too. When hideInactiveLinkButtons is on, link buttons
  // outside the active verse are suppressed in both strips. (A link slot sits between phrases, so
  // segment — not phrase focus — governs it.)
  const slotInActiveSegment =
    activeSegmentId !== undefined &&
    prevSegmentId === activeSegmentId &&
    nextSegmentId === activeSegmentId;
  const suppressLinkIcon = hideInactiveLinkButtons && !slotInActiveSegment;
  const hasLinkableNeighbors = prevToken !== undefined || nextToken !== undefined;
  return (
    <span
      className="tw:link-slot tw:pointer-events-auto"
      data-link-slot="true"
      style={{ overflowAnchor: 'none' }}
    >
      {hasLinkableNeighbors && (
        <span
          aria-hidden={suppressLinkIcon || undefined}
          className="tw:transition-opacity tw:ease-in-out"
          style={{
            display: 'inline-flex',
            minHeight: '1rem',
            opacity: suppressLinkIcon ? 0 : 1,
            overflowAnchor: 'none',
            pointerEvents: suppressLinkIcon ? 'none' : undefined,
            transitionDuration: skipLinkTransition ? '0ms' : `${LINK_SLOT_TRANSITION_MS}ms`,
          }}
        >
          <MemoizedTokenLinkIcon
            slotFocus={slotFocus}
            isPhraseRevealed={phraseRevealed}
            nextPhraseLink={nextGroup?.phraseLink}
            nextToken={nextToken}
            prevPhraseLink={prevGroup?.phraseLink}
            prevToken={prevToken}
          />
        </span>
      )}
      {punctuation.length > 0 && (
        <span className="tw:inline-flex tw:flex-row tw:items-center">
          {punctuation.map((punctToken) => (
            <InertTokenChip key={punctToken.ref} token={punctToken} />
          ))}
        </span>
      )}
    </span>
  );
}

// #endregion

// #region PhraseGroup

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
  /** Whether hover handlers are wired (only in view mode for real phrases). */
  allowHover: boolean;
  /**
   * PhraseId of this group's phrase, or `undefined` for a solo token. Passed as a data value so
   * hover callbacks can be stable references rather than per-render closures.
   */
  phraseId: string | undefined;
  /**
   * First-token ref of this group; identifies it to the parent's hover and focus handlers. Passed
   * as a data value so hover callbacks can be stable references rather than per-render closures.
   */
  groupKey: string;
  /** Called with the phraseId (or `undefined`) on pointer enter/leave when `allowHover` is true. */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Sets (or clears) the hovered group key on pointer enter/leave when `allowHover` is true. */
  setHoveredGroupKey: (key: string | undefined) => void;
  /** Called with this group's key when its gloss input gains focus. */
  onFocusPhrase: (groupKey: string) => void;
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
 * Accepts `phraseId` and `groupKey` as data props and calls the stable `onHoverPhrase`,
 * `setHoveredGroupKey`, and `onFocusPhrase` callbacks with them so the parent never needs to create
 * per-render closures, preserving the `memo()` bail-out on unchanged props.
 *
 * @param props - Component props
 * @param props.group - The phrase group to render
 * @param props.isFocused - Whether this group is the navigation focus
 * @param props.isHighlighted - Whether this group renders highlighted
 * @param props.splitFreeTokenRefs - Token refs in this group that preview as becoming free
 * @param props.showControls - Whether to show the controls pill
 * @param props.showGlossInput - Whether to show the gloss input
 * @param props.allowHover - Whether hover handlers are wired
 * @param props.phraseId - PhraseId passed to hover callbacks
 * @param props.groupKey - Group key passed to hover/focus callbacks
 * @param props.onHoverPhrase - Called with phraseId on pointer enter/leave
 * @param props.setHoveredGroupKey - Called with groupKey on pointer enter/leave
 * @param props.onFocusPhrase - Called with groupKey when this group's gloss input gains focus
 * @param props.groupRef - Optional DOM-ref callback for the wrapper span
 * @returns A wrapper span containing the phrase box.
 */
export const MemoizedPhraseGroup = memo(function PhraseGroup({
  group,
  isFocused,
  isHighlighted,
  splitFreeTokenRefs,
  showControls,
  showGlossInput,
  allowHover,
  phraseId,
  groupKey,
  onHoverPhrase,
  setHoveredGroupKey,
  onFocusPhrase,
  groupRef,
}: PhraseGroupProps) {
  return (
    <span
      ref={groupRef}
      // The strip wrapper is `pointer-events-none` so its padding gaps let arc-split button clicks
      // through to the buttons beneath; re-enable events on the actual phrase content here.
      className="tw:pointer-events-auto"
      onMouseEnter={
        allowHover
          ? () => {
              onHoverPhrase(phraseId);
              setHoveredGroupKey(groupKey);
            }
          : undefined
      }
      onMouseLeave={
        allowHover
          ? () => {
              onHoverPhrase(undefined);
              setHoveredGroupKey(undefined);
            }
          : undefined
      }
    >
      <MemoizedPhraseBox
        isFocused={isFocused}
        isHighlighted={isHighlighted}
        splitFreeTokenRefs={splitFreeTokenRefs}
        punctuationBetween={group.punctuationBetween}
        groupKey={groupKey}
        onFocusPhrase={onFocusPhrase}
        phraseLink={group.phraseLink}
        showControls={showControls}
        showGlossInput={showGlossInput}
        tokens={group.tokens}
      />
    </span>
  );
});

// #endregion

// #region PhraseStrip

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
  onHoverPhrase,
  setHoveredGroupKey,
  onFocusPhrase,
}: PhraseStripProps) {
  const { simplifyPhrases } = usePhraseStripContext();
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
    // When simplifyPhrases is on, only the focused phrase exposes interactive controls; every other
    // phrase still highlights on hover but shows no split/unlink/remove affordances. When off,
    // controls follow the usual hover rules on any phrase.
    const phraseControlsAllowed =
      !simplifyPhrases || (phraseId !== undefined && phraseId === focus.focusedPhraseId);
    const isHighlighted = (() => {
      if (phraseMode.kind === 'view') {
        if (phraseId !== undefined && phraseId === hoveredPhraseId) return true;
        if (phraseId !== undefined && phraseId === focus.focusedPhraseId) return true;
        if (group.tokens.some((t) => candidateTokenRefs.has(t.ref))) return true;
        return false;
      }
      return phraseId !== undefined && phraseId === phraseMode.phraseId;
    })();
    return (
      <MemoizedPhraseGroup
        key={groupKey}
        group={group}
        isFocused={item.isFocused}
        isHighlighted={isHighlighted}
        splitFreeTokenRefs={
          phraseControlsAllowed && phraseMode.kind === 'view'
            ? splitFreeTokenRefs
            : EMPTY_SPLIT_FREE_REFS
        }
        showControls={
          phraseControlsAllowed &&
          phraseMode.kind === 'view' &&
          phraseId !== undefined &&
          groupKey === hoveredGroupKey
        }
        showGlossInput={showGlossInput}
        allowHover={phraseMode.kind === 'view' && phraseId !== undefined}
        phraseId={phraseId}
        groupKey={groupKey}
        onHoverPhrase={onHoverPhrase}
        setHoveredGroupKey={setHoveredGroupKey}
        onFocusPhrase={onFocusPhrase}
        groupRef={item.groupRef}
      />
    );
  });
}

// #endregion
