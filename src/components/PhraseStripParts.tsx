/** @file Shared render parts for the two phrase strips (SegmentView and ContinuousView). */
import type { PhraseAnalysisLink } from 'interlinearizer';
import type { Dispatch, SetStateAction } from 'react';
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from '../types/phrase-mode';
import { MemoizedInertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
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
  /** Current phrase-interaction mode; controls link-icon click behavior. */
  phraseMode: PhraseMode;
  /** Token ref → flat document index, for document-order phrase merges. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Called with the phraseId (or `undefined`) when a candidate phrase is hovered. */
  onHoverCandidatePhrase: (phraseId: string | undefined) => void;
  /** Called with the candidate token refs (or `undefined`) when a link icon is hovered. */
  onHoverCandidateTokens: (refs: readonly string[] | undefined) => void;
  /** Called with the would-be-free token refs (or `undefined`) when a split icon is hovered. */
  onHoverSplitFreeTokens: (refs: readonly string[] | undefined) => void;
}>;

/**
 * Renders one between-group slot: the link/unlink icon plus any punctuation tokens that sit in the
 * gap. Pure — both views feed it identical inputs so the slot renders the same in either layout.
 *
 * @param props - Component props
 * @param props.slot - The slot's neighboring groups and gap punctuation
 * @param props.focus - Resolved focus context for the link icon's focus inputs
 * @param props.prevSegmentId - Segment id of the group before the slot
 * @param props.nextSegmentId - Segment id of the group after the slot
 * @param props.focusedSideIsPrev - Whether focus is start-ward of this slot
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the view
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.tokenDocOrder - Token ref → flat document index lookup
 * @param props.onHoverCandidatePhrase - Called when a candidate phrase is hovered
 * @param props.onHoverCandidateTokens - Called when a link icon is hovered
 * @param props.onHoverSplitFreeTokens - Called when a split icon is hovered
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
  phraseMode,
  tokenDocOrder,
  onHoverCandidatePhrase,
  onHoverCandidateTokens,
  onHoverSplitFreeTokens,
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
  const slotFocus = resolveSlotFocus(
    prevSegmentId,
    nextSegmentId,
    focus.focusedSegmentId,
    focusedSideIsPrev,
  );
  return (
    <span className="tw:link-slot">
      <MemoizedTokenLinkIcon
        focusedFreeToken={focus.focusedFreeToken}
        focusedPhraseLink={focus.focusedPhraseLink}
        focusedSideIsPrev={slotFocus.focusedSideIsPrev}
        isSameSegmentAsFocus={slotFocus.isSameSegmentAsFocus}
        isPhraseRevealed={phraseRevealed}
        nextPhraseLink={nextGroup?.phraseLink}
        nextToken={nextToken}
        onHoverCandidatePhrase={onHoverCandidatePhrase}
        onHoverCandidateTokens={onHoverCandidateTokens}
        onHoverSplitFreeTokens={onHoverSplitFreeTokens}
        phraseMode={phraseMode}
        prevPhraseLink={prevGroup?.phraseLink}
        prevToken={prevToken}
        tokenDocOrder={tokenDocOrder}
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
  /** First-token ref of the group; used as the React key, hover key, and `PhraseBox` focus ref. */
  groupKey: string;
  /** Whether this group is the current navigation focus (computed by the parent). */
  isFocused: boolean;
  /** Whether this group should render highlighted (computed by the parent). */
  isHighlighted: boolean;
  /** Whether this group would become free after a hovered split/unlink (computed by the parent). */
  isSplitFree: boolean;
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
  /** Called with `groupKey` when the phrase gains focus. */
  onFocusPhrase: (focusRef?: string) => void;
  /** Optional DOM-ref callback for the wrapper span; used by ContinuousView for scroll-into-view. */
  groupRef?: (el: HTMLSpanElement | null) => void;
  /** Current phrase-interaction mode; passed through to `PhraseBox`. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed through to `PhraseBox`. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token list of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseTokens: PhraseAnalysisLink['tokens'] | undefined;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref → segment id lookup; passed through to `PhraseBox` for segment-scope edit. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Token ref → flat document index; passed through to `PhraseBox` for document-order edit adds. */
  tokenDocOrder: ReadonlyMap<string, number>;
}>;

/**
 * Renders one phrase group: the hover-wrapper span around a `MemoizedPhraseBox`. Pure — both views
 * feed it identical, pre-computed inputs so the box renders the same in either layout. The parent
 * owns all layout-specific math (focus highlighting, hover state, scroll refs) and passes the
 * results in.
 *
 * @param props - Component props
 * @param props.group - The phrase group to render
 * @param props.groupKey - First-token ref of the group
 * @param props.isFocused - Whether this group is the navigation focus
 * @param props.isHighlighted - Whether this group renders highlighted
 * @param props.isSplitFree - Whether this group previews as becoming free
 * @param props.showControls - Whether to show the controls pill
 * @param props.showGlossInput - Whether to show the gloss input
 * @param props.arcOffsetPx - Upward offset for the controls pill
 * @param props.allowHover - Whether hover handlers are wired
 * @param props.onHoverEnter - Pointer-enter handler
 * @param props.onHoverLeave - Pointer-leave handler
 * @param props.onFocusPhrase - Called with `groupKey` when the phrase gains focus
 * @param props.groupRef - Optional DOM-ref callback for the wrapper span
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.editPhraseTokens - Token list of the phrase being edited
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited
 * @param props.tokenSegmentMap - Token ref → segment id lookup
 * @param props.tokenDocOrder - Token ref → flat document index, for document-order edit adds
 * @returns A wrapper span containing the phrase box.
 */
export function PhraseGroup({
  group,
  groupKey,
  isFocused,
  isHighlighted,
  isSplitFree,
  showControls,
  showGlossInput,
  arcOffsetPx,
  allowHover,
  onHoverEnter,
  onHoverLeave,
  onFocusPhrase,
  groupRef,
  phraseMode,
  setPhraseMode,
  editPhraseTokens,
  editPhraseSegmentId,
  tokenSegmentMap,
  tokenDocOrder,
}: PhraseGroupProps) {
  return (
    <span
      ref={groupRef}
      onMouseEnter={allowHover ? onHoverEnter : undefined}
      onMouseLeave={allowHover ? onHoverLeave : undefined}
    >
      <MemoizedPhraseBox
        arcOffsetPx={arcOffsetPx}
        editPhraseSegmentId={editPhraseSegmentId}
        editPhraseTokens={editPhraseTokens}
        focusRef={groupKey}
        isFocused={isFocused}
        isHighlighted={isHighlighted}
        isSplitFree={isSplitFree}
        onFocusPhrase={onFocusPhrase}
        phraseLink={group.phraseLink}
        phraseMode={phraseMode}
        setPhraseMode={setPhraseMode}
        showControls={showControls}
        showGlossInput={showGlossInput}
        tokens={group.tokens}
        tokenDocOrder={tokenDocOrder}
        tokenSegmentMap={tokenSegmentMap}
      />
    </span>
  );
}
