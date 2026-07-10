/** @file Shared render parts for the two phrase strips (SegmentView and ContinuousView). */
import { useLocalizedStrings } from '@papi/frontend/react';
import type { Token } from 'interlinearizer';
import { Merge, Split } from 'lucide-react';
import { memo } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import MemoizedPhraseBox from './PhraseBox';
import { useAltHeldValue } from './AltHeldContext';
import type { PhraseMode } from '../types/phrase-mode';
import { usePhraseStripContext } from './PhraseStripContext';
import { useSegmentation } from './SegmentationStore';
import { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import type { FocusContext, LinkSlot, TokenGroup } from '../types/token-layout';
import { resolveSlotFocus } from '../utils/token-layout';
import { resolveSplitAnchor } from '../utils/split-anchor';

/** Localized labels for the merge/split boundary controls; hoisted so the array reference is stable. */
const BOUNDARY_STRING_KEYS = [
  '%interlinearizer_boundaryControl_merge%',
  '%interlinearizer_boundaryControl_mergeHint%',
  '%interlinearizer_boundaryControl_split%',
] as const satisfies `%${string}%`[];

/** Props for {@link BoundaryButton}. */
type BoundaryButtonProps = Readonly<{
  /** Accessible label for screen readers. */
  label: string;
  /** Tooltip text; may differ from `label` (e.g. the merge button's split-discoverability hint). */
  title: string;
  /** `data-testid` for the button element. */
  testId: string;
  /** The icon rendered inside the button. */
  icon: ReactNode;
  /** When `true` the control renders inert; used while a phrase mode (edit / unlink) is active. */
  disabled: boolean;
  /** The boundary edit to run on click. */
  action: () => void;
}>;

/**
 * One boundary-edit button (only merge, now — split is the Alt-gated marker below). Its own CSS
 * `hover:bg-accent` is the only hover affordance; it no longer feeds the shared candidate-token
 * highlight channel (that channel stays for the link icon).
 *
 * @param props - Component props.
 * @param props.label - Accessible label for screen readers.
 * @param props.title - Tooltip text (may differ from the label).
 * @param props.testId - `data-testid` for the button element.
 * @param props.icon - The icon rendered inside the button.
 * @param props.disabled - Renders the control inert while a phrase mode is active.
 * @param props.action - The boundary edit to run on click.
 * @returns The styled boundary button.
 */
function BoundaryButton({ label, title, testId, icon, disabled, action }: BoundaryButtonProps) {
  return (
    <button
      aria-label={label}
      className="tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground tw:disabled:pointer-events-none tw:disabled:opacity-30"
      data-testid={testId}
      disabled={disabled}
      tabIndex={-1}
      title={title}
      type="button"
      onClick={action}
    >
      {icon}
    </button>
  );
}

/** Props for {@link BoundaryControl}. */
type BoundaryControlProps = Readonly<{
  /** Segment id of the group before the slot, or `undefined` for the leading slot. */
  prevSegmentId: string | undefined;
  /** Segment id of the group after the slot, or `undefined` for the trailing slot. */
  nextSegmentId: string | undefined;
  /**
   * Last word token before the slot, or `undefined` for a leading slot. A slot with no word token
   * before it sits on an existing segment start, where a split would be a no-op, so no control
   * renders there.
   */
  prevToken: Token | undefined;
  /**
   * First word token after the slot — the word boundary the split's eligibility is checked on, and
   * the default split anchor when no punctuation travels ahead of it.
   */
  nextToken: Token | undefined;
  /**
   * Punctuation tokens sitting in the gap between the two words, in document order. Fed to
   * {@link resolveSplitAnchor} so leading-quote punctuation lands on the following segment.
   */
  punctuation: readonly Token[];
}>;

/**
 * Renders the boundary-edit control for one slot — the merge/split button that takes over the slot
 * column's punctuation row while Alt is held. {@link PhraseSlot} only mounts this component when Alt
 * is held (the row otherwise shows the gap punctuation), so there is no Alt-off state and no dashed
 * indicator here: this always tries to render an actionable button.
 *
 * - A slot straddling two different segments (a live boundary) shows the `Merge` button (combine the
 *   next segment into the previous one).
 * - A slot inside one segment shows the `Split` marker (start a new segment at the resolved
 *   punctuation-travel anchor). `Split` (one stroke diverging into two) and `Merge` (two strokes
 *   converging into one) are a mirrored lucide pair, so the two operations read as one system yet
 *   stay distinct at icon size.
 *
 * Returns `undefined` (leaving the row blank even under Alt) for slots where no edit applies:
 * leading/trailing slots (a word token missing on either side — a leading slot sits on an existing
 * segment start, where a split would be a no-op), and intra-segment slots where the split is
 * suppressed by the not-mid-phrase UI guard.
 *
 * The not-mid-phrase rule: no split marker renders at a boundary that would cut a phrase —
 * including the gap between two fragments of a discontiguous phrase — and an Alt+click there is a
 * silent no-op (the absent marker is the explanation). (The segmentation dispatch itself accepts
 * such boundaries and force-breaks the straddled phrases; only callers that cannot see token chunks
 * take that path.) Merge needs no such guard: removing a boundary can never leave a phrase
 * straddling one.
 *
 * The merge button renders disabled, and the split marker is hidden, while a phrase mode (edit /
 * confirm-unlink) is active: a boundary edit mid-mode could re-segment the phrase the mode UI is
 * operating on (e.g. canceling an edit would then restore a phrase spanning the new boundary).
 *
 * @param props - Component props.
 * @param props.prevSegmentId - Segment id before the slot.
 * @param props.nextSegmentId - Segment id after the slot.
 * @param props.prevToken - Last word token before the slot.
 * @param props.nextToken - First word token after the slot (the word boundary).
 * @param props.punctuation - Gap punctuation between the two words, in document order.
 * @returns The merge button or the split marker, or `undefined` when no edit applies at this slot.
 */
function BoundaryControl({
  prevSegmentId,
  nextSegmentId,
  prevToken,
  nextToken,
  punctuation,
}: BoundaryControlProps) {
  const { dispatch, segmentById, formerBoundaries, straddledBoundaryRefs } = useSegmentation();
  const { phraseMode } = usePhraseStripContext();
  const [localizedStrings] = useLocalizedStrings(BOUNDARY_STRING_KEYS);
  if (
    prevSegmentId === undefined ||
    nextSegmentId === undefined ||
    prevToken === undefined ||
    nextToken === undefined
  ) {
    return undefined;
  }

  const nextTokenRef = nextToken.ref;
  const boundaryEditsDisabled = phraseMode.kind !== 'view';

  // A cross-segment slot sits on a live boundary → merge; an intra-segment slot can be split.
  if (prevSegmentId !== nextSegmentId) {
    const nextSegment = segmentById.get(nextSegmentId);
    const secondStart = nextSegment?.tokens[0]?.ref;
    /* v8 ignore next -- a rendered cross-segment slot always resolves the next segment's start */
    if (nextSegment === undefined || secondStart === undefined) return undefined;
    return (
      <span className="tw:inline-flex tw:min-h-4 tw:items-center">
        <BoundaryButton
          label={localizedStrings['%interlinearizer_boundaryControl_merge%']}
          title={localizedStrings['%interlinearizer_boundaryControl_mergeHint%']}
          testId="boundary-merge-btn"
          icon={<Merge className="tw:h-3 tw:w-3" />}
          disabled={boundaryEditsDisabled}
          action={() => dispatch.merge(secondStart)}
        />
      </span>
    );
  }

  // The not-mid-phrase UI guard: no split marker at a boundary that would cut a phrase (the absent
  // marker is the explanation; an Alt+click there is a silent no-op).
  const splittable = !boundaryEditsDisabled && !straddledBoundaryRefs.has(nextTokenRef);
  if (!splittable) return undefined;

  return (
    <span className="tw:inline-flex tw:min-h-4 tw:items-center">
      <SplitMarker
        label={localizedStrings['%interlinearizer_boundaryControl_split%']}
        // A split on a former boundary dispatches the original removed default start — which may be a
        // leading punctuation token no word-anchored slot could name — so the restore cancels the
        // removal exactly and the delta can normalize back to the default segmentation. Otherwise the
        // anchor comes from the punctuation-travel rule so leading-quote punctuation lands on the
        // following segment.
        onSplit={() => {
          /* v8 ignore next -- an intra-segment split slot always resolves its segment's baseline */
          const baselineText = segmentById.get(nextSegmentId)?.baselineText ?? '';
          const splitRef =
            formerBoundaries.get(nextTokenRef) ??
            resolveSplitAnchor(prevToken, nextToken, punctuation, baselineText);
          dispatch.split(splitRef);
        }}
      />
    </span>
  );
}

/** Props for {@link SplitMarker}. */
type SplitMarkerProps = Readonly<{
  /** Accessible label and tooltip for the marker. */
  label: string;
  /** Runs the split at the resolved anchor; called only for a genuine Alt+click. */
  onSplit: () => void;
}>;

/**
 * The Alt-gated split marker: a lightweight `Split` glyph that reveals a splittable word-word gap
 * while Alt is held. Only an actual Alt+click runs the split — a plain click (Alt released between
 * render and click) is ignored — so the marker never fights the plain-click select/focus behavior.
 * Keyboard split is out of scope, so this is a pointer-only affordance (the relevant a11y lint
 * rules are disabled, matching the segment-container click handlers).
 *
 * @param props - Component props.
 * @param props.label - Accessible label and tooltip.
 * @param props.onSplit - Runs the split; called only for a genuine Alt+click.
 * @returns The split-marker span.
 */
function SplitMarker({ label, onSplit }: SplitMarkerProps) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span
      aria-label={label}
      className="tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground"
      data-testid="boundary-split-marker"
      title={label}
      onClick={(event: MouseEvent) => {
        if (event.altKey) onSplit();
      }}
    >
      <Split className="tw:h-3 tw:w-3" />
    </span>
  );
}

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
  /**
   * Verse label shown below the link icon when a verse begins at this slot, or `undefined`
   * otherwise. Rendered here (not by either view) so both strips mark verse boundaries
   * identically.
   */
  verseLabel: string | undefined;
}>;

/**
 * Renders one between-group slot as a fixed vertical column whose stacked items always land in the
 * same place across the whole strip, top to bottom:
 *
 * 1. The verse number (when a verse begins here) — absolutely positioned so it peeks above the
 *    column's top edge without consuming layout height, so it never pushes the rows below it.
 * 2. Gap punctuation — the first in-flow row, aligned with the neighboring token surface text. While
 *    Alt is held the merge/split boundary button REPLACES the punctuation in this same row (the two
 *    are never shown together), so revealing the control changes nothing else about the column.
 * 3. The link/unlink icon (the fade-carrying row).
 *
 * Every in-flow row is a fixed height, reserved (and blank) even when its item is absent, so the
 * columns line up strip-wide and each item sits at an identical vertical offset regardless of which
 * of the others are present — and pressing Alt only swaps the punctuation row's content in place.
 * Pure — both views feed it identical inputs so the slot renders the same in either layout, which
 * is why the verse number and boundary controls live here rather than in each view: both strips
 * mark verse boundaries identically. The link icon's phrase mode, document-order lookup, and hover
 * callbacks come from {@link PhraseStripContext}.
 *
 * @param props - Component props
 * @param props.slot - The slot's neighboring groups and gap punctuation
 * @param props.focus - Resolved focus context for the link icon's focus inputs
 * @param props.prevSegmentId - Segment id of the group before the slot
 * @param props.nextSegmentId - Segment id of the group after the slot
 * @param props.focusedSideIsPrev - Whether focus is start-ward of this slot
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the view
 * @param props.verseLabel - Verse label that peeks above the column when a verse begins here
 * @returns A `link-slot` fixed column, or `undefined` when the slot has nothing to render.
 */
export function PhraseSlot({
  slot,
  focus,
  prevSegmentId,
  nextSegmentId,
  focusedSideIsPrev,
  hoveredPhraseId,
  verseLabel,
}: PhraseSlotProps) {
  const { hideInactiveLinkButtons, activeSegmentId, skipLinkTransition } = usePhraseStripContext();
  const { segmentOrder } = useSegmentation();
  const altHeld = useAltHeldValue();
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
  const slotFocus = resolveSlotFocus(
    prevSegmentId,
    nextSegmentId,
    focus,
    focusedSideIsPrev,
    segmentOrder,
  );
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
  // The slot is a fixed column so every inter-phrase item lands in the same place across the whole
  // strip, top to bottom: the verse number (peeking above the column), then gap punctuation, then
  // the link icon, then the Alt-gated merge/split button. Each in-flow row is a fixed height,
  // reserved (blank when empty), so the rows line up column-to-column: every item sits at the same
  // vertical offset regardless of which others are present, and revealing the boundary button on an
  // Alt press never reflows the surrounding phrases. `relative` anchors the peeking verse number.
  return (
    <span
      // `mt-1` shifts the whole column (peeking verse number included) down so the punctuation row
      // lands on the neighboring token surface-text baseline — the slot column starts at the token
      // row's top, above where each phrase box's border + padding push its surface text down, so
      // without this nudge the punctuation sat a few px high.
      //
      // `min-w-4` reserves a normal slot's width (the link icon is ~16px) even when every in-flow row
      // is empty — chiefly the LEADING slot before a strip's first group, which has no prev token so
      // no link icon renders. Without it that column collapses to ~0px and a verse number opening the
      // strip (peeking, centered on the column) crams against the first token; the reserved gap gives
      // it the same room as a verse number mid-strip.
      className="tw:link-slot tw:pointer-events-auto tw:relative tw:mt-1 tw:inline-flex tw:min-w-4 tw:flex-col tw:items-center"
      data-link-slot="true"
      style={{ overflowAnchor: 'none' }}
    >
      {/* Verse number: absolutely positioned so it peeks ABOVE the column's top edge (bottom-anchored
          to the top) without consuming any layout height — so the punctuation row below stays in line
          with the neighboring token surface text, and the number never pushes the rows down. Always
          rendered when a verse begins here; nothing in the column ever removes or covers it. */}
      {verseLabel !== undefined && (
        <span
          className="tw:pointer-events-none tw:absolute tw:bottom-full tw:left-1/2 tw:-translate-x-1/2 tw:text-[0.7em] tw:font-semibold tw:leading-none tw:text-muted-foreground"
          data-testid="verse-superscript"
        >
          {verseLabel}
        </span>
      )}
      {/* Punctuation row — the first in-flow row, a FIXED height so a slot carrying a punctuation chip
          is exactly as tall as an empty one. The gap punctuation is ALWAYS in normal flow, so it
          alone sets the row's width — even while Alt is held. `items-start` sits it on the
          neighboring token surface-text baseline. While Alt is held the merge/split button is
          overlaid (absolutely centered over the row) and the punctuation is hidden with
          `visibility: hidden` rather than removed, so the row keeps the SAME width it had before the
          Alt press: multi-chip gaps no longer shrink to the button's width and shift the whole strip.
          `relative` anchors the overlay; `min-w-4` gives the button room even when the gap is empty. */}
      <span className="tw:relative tw:inline-flex tw:h-5 tw:min-w-4 tw:flex-row tw:items-start tw:justify-center tw:overflow-hidden">
        <span
          className="tw:inline-flex tw:flex-row tw:items-start"
          data-testid="slot-punctuation"
          style={{ visibility: altHeld && hasLinkableNeighbors ? 'hidden' : undefined }}
        >
          {punctuation.map((punctToken) => (
            <InertTokenChip key={punctToken.ref} token={punctToken} />
          ))}
        </span>
        {altHeld && hasLinkableNeighbors && (
          // `translate-y-0.5` nudges the button down a couple px from the row's vertical center so it
          // reads as centered against the neighboring token surface text (the row sits at the column
          // top, slightly above the surface-text line).
          <span className="tw:absolute tw:inset-0 tw:flex tw:translate-y-0.5 tw:items-center tw:justify-center">
            <BoundaryControl
              prevSegmentId={prevSegmentId}
              nextSegmentId={nextSegmentId}
              prevToken={prevToken}
              nextToken={nextToken}
              punctuation={punctuation}
            />
          </span>
        )}
      </span>
      {/* Link icon (or reserved blank height when this slot has no linkable neighbors), the bottom
          row. Carries the fade transition; identified by data-testid so tests don't depend on its
          position. */}
      <span
        aria-hidden={!hasLinkableNeighbors || suppressLinkIcon || undefined}
        className="tw:transition-opacity tw:ease-in-out"
        data-testid="link-slot-icon"
        style={{
          display: 'inline-flex',
          minHeight: '1rem',
          opacity: hasLinkableNeighbors && !suppressLinkIcon ? 1 : 0,
          overflowAnchor: 'none',
          pointerEvents: hasLinkableNeighbors && !suppressLinkIcon ? undefined : 'none',
          transitionDuration: skipLinkTransition ? '0ms' : `${LINK_SLOT_TRANSITION_MS}ms`,
        }}
      >
        {hasLinkableNeighbors && (
          <MemoizedTokenLinkIcon
            slotFocus={slotFocus}
            isPhraseRevealed={phraseRevealed}
            nextPhraseLink={nextGroup?.phraseLink}
            nextToken={nextToken}
            prevPhraseLink={prevGroup?.phraseLink}
            prevToken={prevToken}
          />
        )}
      </span>
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
  /** Whether this group's tokens are part of a hovered operation preview (computed by the parent). */
  isCandidate: boolean;
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
 * @param props.isCandidate - Whether this group's tokens are part of a hovered operation preview
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
  isCandidate,
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
        isCandidate={isCandidate}
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

/**
 * Renders one inline verse-number superscript within the token strip. Marks a verse start in
 * document order so the running text announces verse identity where a per-segment label used to.
 *
 * @param props - Component props.
 * @param props.label - The verse label to display (verbatim number, or `chapter:number` at a
 *   chapter transition).
 * @returns A superscript element carrying the verse label.
 */
export function VerseSuperscript({ label }: Readonly<{ label: string }>) {
  return (
    <sup
      className="tw:mr-0.5 tw:align-super tw:text-[0.6em] tw:font-semibold tw:text-muted-foreground tw:pointer-events-none"
      data-testid="verse-superscript"
    >
      {label}
    </sup>
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
      /**
       * Verse label to show at this slot when it begins a verse (verbatim number, or
       * `chapter:number` at a chapter transition), or `undefined` when no verse starts here.
       * {@link PhraseSlot} renders it below the link icon so both views mark verse boundaries
       * identically. Each view resolves which slot starts a verse from its own verse-start data.
       */
      verseLabel: string | undefined;
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
  /** Token refs a hovered link icon or boundary merge/split control would affect. */
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
 * @param props.candidateTokenRefs - Token refs a hovered link or boundary control would affect
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
          verseLabel={item.verseLabel}
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
    // Candidate tokens are a hovered operation preview (link icon or boundary merge/split); their
    // groups render the strong candidate tier — distinct from the hover/focus highlight — and the
    // preview never reveals a phrase's edit controls the way a hover does.
    const isCandidate =
      phraseMode.kind === 'view' && group.tokens.some((t) => candidateTokenRefs.has(t.ref));
    const isHighlighted = (() => {
      if (phraseMode.kind === 'view') {
        if (phraseId !== undefined && phraseId === hoveredPhraseId) return true;
        if (phraseId !== undefined && phraseId === focus.focusedPhraseId) return true;
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
        isCandidate={isCandidate}
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
