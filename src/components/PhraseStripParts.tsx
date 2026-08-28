import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { Merge, Split } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'platform-bible-react';
import { memo } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { PhraseMode } from '../types/phrase-mode';
import type { FocusContext, LinkSlot, TokenGroup } from '../types/token-layout';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../utils/localized-strings';
import { resolveSplitAnchor } from '../utils/split-anchor';
import { resolveSlotFocus } from '../utils/token-layout';
import { altKeyHint } from './alt-key-hint';
import { useAltHeldValue } from './AltHeldContext';
import MemoizedPhraseBox from './PhraseBox';
import { usePhraseStripContext } from './PhraseStripContext';
import { useSegmentation } from './SegmentationStore';
import { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';

/** Props for {@link BoundaryButton}. */
type BoundaryButtonProps = Readonly<{
  /** Accessible label for screen readers. */
  label: string;
  /**
   * Tooltip content; may differ from `label`, and may carry elements rather than bare text.
   * `undefined` leaves the tooltip unmounted, so nothing pops on hover.
   */
  title: ReactNode | undefined;
  /** `data-testid` for the button element. */
  testId: string;
  /** The icon rendered inside the button. */
  icon: ReactNode;
  /** The boundary edit to run on click. */
  action: () => void;
}>;

/**
 * One boundary-edit button (only merge — split is the Alt-gated marker below). Merge is always
 * available, so there is no disabled styling. Its CSS `hover:bg-accent` is the only hover
 * affordance; it does not feed the shared candidate-token highlight channel (that stays for the
 * link icon).
 */
function BoundaryButton({ label, title, testId, icon, action }: BoundaryButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="tw:inline-flex tw:h-auto tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground"
          data-testid={testId}
          onClick={action}
          tabIndex={-1}
          type="button"
          variant="ghost"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      {title !== undefined && <TooltipContent>{title}</TooltipContent>}
    </Tooltip>
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
   * Punctuation tokens sitting in the gap between the two words, in document order. Taken into
   * account when resolving the split anchor, so leading-quote punctuation lands on the following
   * segment.
   */
  punctuation: readonly Token[];
}>;

/**
 * Renders the boundary-edit control for one slot — the merge button or the Alt-gated split marker,
 * shown in the slot column's dedicated boundary row below the link icon.
 *
 * - A slot straddling two different segments (a live boundary) shows the `Merge` button, always
 *   available, joining the two adjacent segments. Its tooltip carries the Alt-split discoverability
 *   hint while Alt is up (when the split markers are hidden) and drops to the concise action once
 *   Alt is held.
 * - A slot inside one segment shows the `Split` marker only **while Alt is held** (start a new
 *   segment at the resolved punctuation-travel anchor). `Split` and `Merge` are a mirrored lucide
 *   pair, so the two operations read as one system yet stay distinct at icon size.
 *
 * Returns `undefined` only where no boundary edit can ever apply: leading/trailing slots and while
 * a phrase mode is active. An intra-segment slot always renders its reserved-height wrapper — even
 * without a visible marker — so the strip doesn't reflow when Alt or the not-mid-phrase guard
 * toggles.
 *
 * The not-mid-phrase rule: no split marker renders at a boundary that would cut a phrase (including
 * the gap between two fragments of a discontiguous phrase), and an Alt+click there is a silent
 * no-op. (The segmentation dispatch itself accepts such boundaries and force-breaks the straddled
 * phrases; that path exists for entry points that cannot see token chunks.) Merge needs no such
 * guard: removing a boundary can never leave a phrase straddling one.
 *
 * No boundary control renders at all while a phrase mode (edit / confirm-unlink) is active: a
 * boundary edit mid-mode could re-segment the phrase the mode UI is operating on.
 */
function BoundaryControl({
  prevSegmentId,
  nextSegmentId,
  prevToken,
  nextToken,
  punctuation,
}: BoundaryControlProps) {
  const { dispatch, segmentById, formerBoundaries, straddledBoundaryRefs } = useSegmentation();
  const { phraseMode, boundaryMergeLabel, boundaryMergeAltHint, boundarySplitLabel } =
    usePhraseStripContext();
  const altHeld = useAltHeldValue();
  if (
    prevSegmentId === undefined ||
    nextSegmentId === undefined ||
    prevToken === undefined ||
    nextToken === undefined
  ) {
    return undefined;
  }

  // A boundary edit mid-mode could re-segment the phrase the mode UI is operating on, so no boundary
  // control renders at all while a phrase mode (edit / confirm-unlink) is active.
  if (phraseMode.kind !== 'view') return undefined;

  const nextTokenRef = nextToken.ref;

  // A cross-segment slot sits on a live boundary → merge; an intra-segment slot can be split.
  if (prevSegmentId !== nextSegmentId) {
    const nextSegment = segmentById.get(nextSegmentId);
    const secondStart = nextSegment?.tokens[0]?.ref;
    /* v8 ignore next -- a rendered cross-segment slot always resolves the next segment's start */
    if (nextSegment === undefined || secondStart === undefined) return undefined;
    // While Alt is up the split markers are hidden, so the merge tooltip advertises the Alt gesture
    // that reveals them; while Alt is held that hint is redundant, so the tooltip is the concise
    // action.
    //
    // Only the tooltip is resolved-or-empty: an unresolved `%…%` localize key would otherwise be
    // visible hover text. The `aria-label` keeps the raw value — emptying it would leave the button
    // with no accessible name at all.
    return (
      <span className="tw:inline-flex tw:min-h-4 tw:items-center">
        <BoundaryButton
          label={boundaryMergeLabel}
          title={tooltipContentOrUndefined(
            altHeld
              ? resolvedOrEmpty(boundaryMergeLabel)
              : altKeyHint(resolvedOrEmpty(boundaryMergeAltHint)),
          )}
          testId="boundary-merge-btn"
          icon={<Merge className="tw:size-3" />}
          action={() => dispatch.merge(secondStart)}
        />
      </span>
    );
  }

  // Split stays Alt-gated: the marker only appears while Alt is held. The not-mid-phrase UI guard
  // additionally suppresses it at a boundary that would cut a phrase (the absent marker is the
  // explanation; an Alt+click there is a silent no-op). The wrapper itself always renders, so Alt
  // toggling doesn't unmount/remount the row and grow the strip unevenly (rows with a live boundary
  // never move, since the merge button's wrapper reserves that height permanently).
  const splittable = altHeld && !straddledBoundaryRefs.has(nextTokenRef);

  return (
    <span className="tw:inline-flex tw:min-h-4 tw:items-center">
      {splittable && (
        <SplitMarker
          label={boundarySplitLabel}
          // A split on a former boundary dispatches the original removed default start (which may be a
          // leading punctuation token no word-anchored slot could name), so the restore cancels the
          // removal exactly and the delta can normalize back to the default segmentation. Otherwise
          // the anchor comes from the punctuation-travel rule so leading-quote punctuation lands on
          // the following segment.
          onSplit={() => {
            /* v8 ignore next -- an intra-segment split slot always resolves its segment's baseline */
            const baselineText = segmentById.get(nextSegmentId)?.baselineText ?? '';
            const splitRef =
              formerBoundaries.get(nextTokenRef) ??
              resolveSplitAnchor(prevToken, nextToken, punctuation, baselineText);
            dispatch.split(splitRef);
          }}
        />
      )}
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
 */
function SplitMarker({ label, onSplit }: SplitMarkerProps) {
  const tooltip = tooltipContentOrUndefined(resolvedOrEmpty(label));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <span
          aria-label={label}
          className="tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground"
          data-testid="boundary-split-marker"
          onClick={(event: MouseEvent) => {
            if (event.altKey) onSplit();
          }}
        >
          <Split className="tw:h-3 tw:w-3" />
        </span>
      </TooltipTrigger>
      {tooltip !== undefined && <TooltipContent>{tooltip}</TooltipContent>}
    </Tooltip>
  );
}

/** Duration, in milliseconds, of the link-slot opacity fade transition. */
export const LINK_SLOT_TRANSITION_MS = 200;

// #region PhraseSlot

/** Props for {@link PhraseSlot}. */
type PhraseSlotProps = Readonly<{
  /** The between-group slot to render: its neighboring groups and any punctuation in the gap. */
  slot: LinkSlot;
  /** Resolved focus context; supplies the link-icon's focus inputs. */
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
   * otherwise. Owned by the slot so verse boundaries are marked identically in every strip layout.
   */
  verseLabel: string | undefined;
}>;

/**
 * Renders one between-group slot as a fixed vertical column whose stacked items always land in the
 * same place across the whole strip, top to bottom:
 *
 * 1. The verse number (when a verse begins here) — absolutely positioned so it peeks above the
 *    column's top edge without consuming layout height, so it never pushes the rows below it.
 * 2. Gap punctuation — the first in-flow row, aligned with the neighboring token surface text.
 * 3. The link/unlink icon (the fade-carrying row).
 * 4. The boundary (merge/split) row.
 *
 * Every in-flow row is a fixed height, reserved (and blank) even when its item is absent, so the
 * columns line up strip-wide and each item sits at an identical vertical offset regardless of which
 * others are present. Pure — identical inputs render an identical slot, which is why the verse
 * number and boundary controls live here rather than in each layout. The link icon's phrase mode,
 * document-order lookup, and hover callbacks come from {@link PhraseStripContext}.
 *
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
  const slotInActiveSegment =
    activeSegmentId !== undefined &&
    prevSegmentId === activeSegmentId &&
    nextSegmentId === activeSegmentId;
  const suppressLinkIcon = hideInactiveLinkButtons && !slotInActiveSegment;
  const hasLinkableNeighbors = prevToken !== undefined || nextToken !== undefined;
  // Fixed column so every inter-phrase item lands in the same place strip-wide (see the component
  // doc). `relative` anchors the peeking verse number.
  return (
    <span
      // `mt-1` shifts the whole column down so the punctuation row lands on the neighboring token
      // surface-text baseline: the column starts at the token row's top, above where each phrase
      // box's border + padding push its surface text down.
      //
      // `min-w-4` reserves a normal slot's width (the link icon is ~16px) even when every in-flow row
      // is empty — chiefly the leading slot before a strip's first group, which has no link icon.
      // Without it that column collapses and a verse number opening the strip crams against the first
      // token.
      className="tw:link-slot tw:pointer-events-auto tw:relative tw:mt-1 tw:inline-flex tw:min-w-4 tw:flex-col tw:items-center"
      data-link-slot="true"
      style={{ overflowAnchor: 'none' }}
    >
      {/* Verse number: absolutely positioned so it peeks above the column's top edge without
          consuming layout height, so the punctuation row below stays in line with the neighboring
          token surface text. */}
      {verseLabel !== undefined && (
        <span
          className="tw:pointer-events-none tw:absolute tw:bottom-full tw:left-1/2 tw:-translate-x-1/2 tw:text-[0.7em] tw:font-semibold tw:leading-none tw:text-muted-foreground"
          data-testid="verse-superscript"
        >
          {verseLabel}
        </span>
      )}
      {/* Punctuation row — the first in-flow row, a fixed height so a slot carrying a punctuation
          chip is exactly as tall as an empty one. `items-start` sits the punctuation on the
          neighboring token surface-text baseline. `min-w-4` reserves a normal slot width even when
          the gap is empty. */}
      <span className="tw:inline-flex tw:h-5 tw:min-w-4 tw:flex-row tw:items-start tw:justify-center">
        <span className="tw:inline-flex tw:flex-row tw:items-start" data-testid="slot-punctuation">
          {punctuation.map((punctToken) => (
            <InertTokenChip key={punctToken.ref} token={punctToken} />
          ))}
        </span>
      </span>
      {/* Link icon (or reserved blank height when this slot has no linkable neighbors). Carries the
          fade transition; identified by data-testid so tests don't depend on its position. */}
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
      {/* Boundary (merge/split) row below the link icon. `BoundaryControl` self-gates: merge button
          on a live boundary, split marker only under Alt, nothing where no edit applies. Rendered
          only when the slot has linkable neighbors, since a slot with none can carry no boundary. */}
      {hasLinkableNeighbors && (
        <BoundaryControl
          prevSegmentId={prevSegmentId}
          nextSegmentId={nextSegmentId}
          prevToken={prevToken}
          nextToken={nextToken}
          punctuation={punctuation}
        />
      )}
    </span>
  );
}

/** Memoized version of {@link PhraseSlot}; use in render-stable strips. */
export const MemoizedPhraseSlot = memo(PhraseSlot);

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
  /** Optional DOM-ref callback for the wrapper span, for scrolling the group into view. */
  groupRef?: (el: HTMLSpanElement | null) => void;
}>;

/**
 * Renders one phrase group: the hover-wrapper span around a `MemoizedPhraseBox`. Pure — identical,
 * pre-computed inputs render an identical box. The parent owns all layout-specific math (focus
 * highlighting, hover state, scroll refs) and passes the results in; strip-wide state (phrase mode,
 * edit context, hover callbacks) reaches the box through {@link PhraseStripContext}.
 *
 * Accepts `phraseId` and `groupKey` as data props and calls the stable `onHoverPhrase`,
 * `setHoveredGroupKey`, and `onFocusPhrase` callbacks with them so the parent never needs to create
 * per-render closures, preserving the `memo()` bail-out on unchanged props.
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
      // One element per group whatever the group renders as, so a count of these is a count of
      // groups — unlike phrase boxes, of which a discontiguous phrase contributes several.
      data-phrase-group="true"
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
 * Renders one inline verse-number superscript within the token strip, marking a verse start in
 * document order so the running text announces verse identity inline. Displays `label` verbatim — a
 * bare verse number, or `chapter:number` at a chapter transition.
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
 * the per-item data a layout must resolve for itself. {@link PhraseStrip} owns everything common
 * (highlight, controls, arc offset, hover wiring); these fields are the layout-specific remainder.
 */
export type StripItem =
  | {
      kind: 'slot';
      /** Stable React key for this slot. */
      key: string;
      /** The slot's neighboring groups and gap punctuation. */
      slot: LinkSlot;
      /** Segment id of the group before the slot; how it is resolved is layout-specific. */
      prevSegmentId: string | undefined;
      /** Segment id of the group after the slot. */
      nextSegmentId: string | undefined;
      /** Whether focus is start-ward of this slot, precomputed by the caller. */
      focusedSideIsPrev: boolean | undefined;
      /**
       * Verse label to show at this slot when it begins a verse (verbatim number, or
       * `chapter:number` at a chapter transition), or `undefined` when no verse starts here.
       * {@link PhraseSlot} renders it below the link icon, so verse boundaries are marked
       * identically wherever the strip appears. Which slot starts a verse is resolved by the caller
       * from its own verse-start data.
       */
      verseLabel: string | undefined;
    }
  | {
      kind: 'group';
      /** Stable React key for this group (its first token ref). */
      key: string;
      /** The phrase group to render. */
      group: TokenGroup;
      /** Whether this group is the navigation focus; which focus ref that keys off is the caller's. */
      isFocused: boolean;
      /** Optional DOM-ref callback for the wrapper span, for scrolling the group into view. */
      groupRef?: (el: HTMLSpanElement | null) => void;
    };

/** Props for {@link PhraseStrip}. */
type PhraseStripProps = Readonly<{
  /** The normalized, ordered strip items built by the calling view. */
  items: StripItem[];
  /** Current phrase-interaction mode; gates controls, split previews, and highlight rules. */
  phraseMode: PhraseMode;
  /** Resolved focus context. */
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
 * Picks the token that carries a discontiguous phrase's single gloss input, so a phrase whose
 * stored first token a baseline edit stranded keeps somewhere to show its gloss. Independent of how
 * much of the strip is mounted, so the gloss does not travel between fragments as a windowed strip
 * slides — a phrase whose owning fragment is outside the window shows no input at all rather than
 * moving it. Ranks by the document order the layout itself follows, so the choice does not rest on
 * the stored array happening to be sorted.
 *
 * @returns The ref of the phrase's earliest token the book still has, or `undefined` when it has
 *   none of them — which is also when no fragment of the phrase renders.
 */
function resolveGlossOwnerRef(
  phraseLink: PhraseAnalysisLink,
  tokenDocOrder: ReadonlyMap<string, number>,
): string | undefined {
  let ownerRef: string | undefined;
  let ownerOrder = Infinity;
  phraseLink.tokens.forEach((t) => {
    const order = tokenDocOrder.get(t.tokenRef);
    if (order !== undefined && order < ownerOrder) {
      ownerOrder = order;
      ownerRef = t.tokenRef;
    }
  });
  return ownerRef;
}

/**
 * Renders a complete phrase strip from normalized {@link StripItem}s: the alternating sequence of
 * {@link PhraseSlot}s and {@link PhraseGroup}s. Every per-group derivation (gloss-input
 * deduplication, arc offset, highlight, controls visibility, hover handlers) is computed here, so a
 * strip behaves identically whatever its layout; the items carry only the layout-specific fields
 * (segment ids, focus side, focus ref, scroll refs).
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
  const { simplifyPhrases, tokenDocOrder } = usePhraseStripContext();
  return items.map((item) => {
    if (item.kind === 'slot') {
      return (
        <MemoizedPhraseSlot
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
    // The owning token belongs to exactly one fragment, so membership names one owner per phrase
    // wherever in that fragment the token sits.
    const glossOwnerRef =
      group.phraseLink === undefined
        ? undefined
        : resolveGlossOwnerRef(group.phraseLink, tokenDocOrder);
    const showGlossInput =
      group.phraseLink === undefined || group.tokens.some((t) => t.ref === glossOwnerRef);
    // When simplifyPhrases is on, only the focused phrase exposes interactive controls; other
    // phrases still highlight on hover. When off, controls follow the usual hover rules on any
    // phrase.
    const phraseControlsAllowed =
      !simplifyPhrases || (phraseId !== undefined && phraseId === focus.focusedPhraseId);
    // Candidate tokens are a hovered operation preview (link icon or boundary merge/split); their
    // groups render the strong candidate tier, distinct from the hover/focus highlight, without
    // revealing edit controls.
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
