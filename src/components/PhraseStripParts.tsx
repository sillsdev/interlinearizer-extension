/** @file Shared render parts for the two phrase strips (SegmentView and ContinuousView). */
import { useLocalizedStrings } from '@papi/frontend/react';
import { FoldHorizontal, Scissors } from 'lucide-react';
import { memo } from 'react';
import type { ReactNode } from 'react';
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from '../types/phrase-mode';
import { usePhraseStripContext } from './PhraseStripContext';
import { useSegmentation } from './SegmentationStore';
import { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import type { FocusContext, LinkSlot, TokenGroup } from '../types/token-layout';
import { isWordToken } from '../types/type-guards';
import { resolveSlotFocus } from '../utils/token-layout';

/** Localized labels for the merge/split boundary controls; hoisted so the array reference is stable. */
const BOUNDARY_STRING_KEYS = [
  '%interlinearizer_boundaryControl_merge%',
  '%interlinearizer_boundaryControl_split%',
  '%interlinearizer_boundaryControl_formerBoundary%',
] as const satisfies `%${string}%`[];

/** Props for {@link BoundaryButton}. */
type BoundaryButtonProps = Readonly<{
  /** Accessible label, doubling as the tooltip. */
  label: string;
  /** `data-testid` for the button element. */
  testId: string;
  /** The icon rendered inside the button. */
  icon: ReactNode;
  /** When `true` the control renders inert; used while a phrase mode (edit / unlink) is active. */
  disabled: boolean;
  /**
   * Lazily computes the word-token refs the operation would affect. Called on hover (not render),
   * so mounting hundreds of slots does no per-render array building.
   *
   * @returns The refs to highlight as the operation's preview.
   */
  getPreviewRefs: () => readonly string[];
  /** The boundary edit to run on click. */
  action: () => void;
}>;

/**
 * One boundary-edit button (merge or split): shared markup, hover-preview wiring, and click
 * cleanup. Entering highlights the refs from `getPreviewRefs` through the shared candidate-token
 * channel (the same one the link icon uses), leaving clears, and click clears synchronously before
 * running the edit so the highlight can't linger over the re-segmented content.
 *
 * @param props - Component props.
 * @param props.label - Accessible label and tooltip.
 * @param props.testId - `data-testid` for the button element.
 * @param props.icon - The icon rendered inside the button.
 * @param props.disabled - Renders the control inert while a phrase mode is active.
 * @param props.getPreviewRefs - Lazily computes the refs the operation would affect.
 * @param props.action - The boundary edit to run on click.
 * @returns The styled boundary button.
 */
function BoundaryButton({
  label,
  testId,
  icon,
  disabled,
  getPreviewRefs,
  action,
}: BoundaryButtonProps) {
  const { onHoverCandidateTokens } = usePhraseStripContext();
  return (
    <button
      aria-label={label}
      className="tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground tw:disabled:pointer-events-none tw:disabled:opacity-30"
      data-testid={testId}
      disabled={disabled}
      tabIndex={-1}
      title={label}
      type="button"
      onClick={() => {
        onHoverCandidateTokens(undefined);
        action();
      }}
      onMouseEnter={() => onHoverCandidateTokens(getPreviewRefs())}
      onMouseLeave={() => onHoverCandidateTokens(undefined)}
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
  prevTokenRef: string | undefined;
  /** First word token after the slot, used as the split anchor. */
  nextTokenRef: string | undefined;
}>;

/**
 * Renders the boundary-edit control for one slot, always visible (not hover-gated). A slot
 * straddling two different segments shows a merge control (combine the next segment into the
 * previous one); a slot inside one segment shows a split control (start a new segment at the next
 * token). Leading/trailing slots (a word token missing on either side) render nothing — a leading
 * slot sits on an existing segment start, where a split would be a no-op.
 *
 * Hovering either control previews its effect through the shared candidate-token highlight (the
 * same channel the link icon uses): merge highlights every word token of both segments (they become
 * one segment); split highlights the word tokens from the split anchor to the segment end (the run
 * that breaks off into the new segment). The preview is cleared on leave and synchronously on click
 * so it can't linger over the re-segmented content.
 *
 * An intra-segment slot sitting on a merged-away default verse start additionally renders a faint
 * dashed tick — the former verse boundary — so the user can see where a split would restore the
 * original segmentation. The tick shows even when the split control itself is suppressed by the
 * not-mid-phrase guard, since it is informational rather than interactive.
 *
 * The not-mid-phrase rule is a UI guard applied here: no split control renders at a boundary that
 * would cut a phrase — including the gap between two fragments of a discontiguous phrase. (The
 * segmentation dispatch itself accepts such boundaries and force-breaks the straddled phrases; only
 * callers that cannot see token chunks take that path.) Merge needs no such guard: removing a
 * boundary can never leave a phrase straddling one.
 *
 * Both controls render disabled while a phrase mode (edit / confirm-unlink) is active, matching the
 * link icons: a boundary edit mid-mode could re-segment the phrase the mode UI is operating on
 * (e.g. canceling an edit would then restore a phrase spanning the new boundary).
 *
 * @param props - Component props.
 * @param props.prevSegmentId - Segment id before the slot.
 * @param props.nextSegmentId - Segment id after the slot.
 * @param props.prevTokenRef - Last word token before the slot.
 * @param props.nextTokenRef - First word token after the slot (split anchor).
 * @returns A merge or split button (with an optional former-boundary tick), or `undefined` when the
 *   slot is at a segment or book edge or nothing applies at this boundary.
 */
function BoundaryControl({
  prevSegmentId,
  nextSegmentId,
  prevTokenRef,
  nextTokenRef,
}: BoundaryControlProps) {
  const { dispatch, segmentById, formerBoundaries, straddledBoundaryRefs } = useSegmentation();
  const { phraseMode } = usePhraseStripContext();
  const [localizedStrings] = useLocalizedStrings(BOUNDARY_STRING_KEYS);
  if (
    prevSegmentId === undefined ||
    nextSegmentId === undefined ||
    prevTokenRef === undefined ||
    nextTokenRef === undefined
  ) {
    return undefined;
  }

  const boundaryEditsDisabled = phraseMode.kind !== 'view';

  const control = (() => {
    if (prevSegmentId !== nextSegmentId) {
      const nextSegment = segmentById.get(nextSegmentId);
      const secondStart = nextSegment?.tokens[0]?.ref;
      /* v8 ignore next -- a rendered cross-segment slot always resolves the next segment's start */
      if (nextSegment === undefined || secondStart === undefined) return undefined;
      return (
        <BoundaryButton
          label={localizedStrings['%interlinearizer_boundaryControl_merge%']}
          testId="boundary-merge-btn"
          icon={<FoldHorizontal className="tw:h-3 tw:w-3" />}
          disabled={boundaryEditsDisabled}
          // Merging joins every token of both segments into one; preview exactly that.
          getPreviewRefs={() =>
            [
              /* v8 ignore next -- a rendered cross-segment slot's previous segment is always mapped */
              ...(segmentById.get(prevSegmentId)?.tokens ?? []),
              ...nextSegment.tokens,
            ]
              .filter(isWordToken)
              .map((t) => t.ref)
          }
          action={() => dispatch.merge(secondStart)}
        />
      );
    }
    // The not-mid-phrase UI guard: no split control at a boundary that would cut a phrase.
    if (straddledBoundaryRefs.has(nextTokenRef)) return undefined;
    // A split on a former boundary dispatches the original removed default start — which may be a
    // leading punctuation token no word-anchored slot could name — so the restore cancels the
    // removal exactly and the delta can normalize back to the default segmentation.
    const splitRef = formerBoundaries.get(nextTokenRef) ?? nextTokenRef;
    return (
      <BoundaryButton
        label={localizedStrings['%interlinearizer_boundaryControl_split%']}
        testId="boundary-split-btn"
        icon={<Scissors className="tw:h-3 tw:w-3" />}
        disabled={boundaryEditsDisabled}
        // Splitting breaks the run from the anchor to the segment end off into a new segment;
        // preview exactly that run.
        getPreviewRefs={() => {
          const segmentTokens = segmentById.get(nextSegmentId)?.tokens ?? [];
          const anchorIndex = segmentTokens.findIndex((t) => t.ref === nextTokenRef);
          /* v8 ignore next -- an intra-segment slot's anchor is always a token of its segment */
          if (anchorIndex === -1) return [];
          return segmentTokens
            .slice(anchorIndex)
            .filter(isWordToken)
            .map((t) => t.ref);
        }}
        action={() => dispatch.split(splitRef)}
      />
    );
  })();

  // The former-boundary tick: an intra-segment slot sitting on a merged-away default verse start.
  const formerBoundaryMarker =
    prevSegmentId === nextSegmentId && formerBoundaries.has(nextTokenRef) ? (
      <span
        aria-hidden="true"
        className="tw:mx-0.5 tw:h-3.5 tw:border-l tw:border-dashed tw:border-muted-foreground/50"
        data-testid="former-boundary-marker"
        title={localizedStrings['%interlinearizer_boundaryControl_formerBoundary%']}
      />
    ) : undefined;

  if (control === undefined && formerBoundaryMarker === undefined) return undefined;
  return (
    <span className="tw:inline-flex tw:min-h-4 tw:items-center">
      {formerBoundaryMarker}
      {control}
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
}>;

/**
 * Renders one between-group slot: the link/unlink icon, the boundary merge/split control, plus any
 * punctuation tokens that sit in the gap. Pure — both views feed it identical inputs so the slot
 * renders the same in either layout. The link icon's phrase mode, document-order lookup, and hover
 * callbacks come from {@link PhraseStripContext}.
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
  const { segmentOrder } = useSegmentation();
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
  return (
    <span
      className="tw:link-slot tw:pointer-events-auto"
      data-link-slot="true"
      style={{ overflowAnchor: 'none' }}
    >
      {hasLinkableNeighbors && (
        <>
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
          <BoundaryControl
            prevSegmentId={prevSegmentId}
            nextSegmentId={nextSegmentId}
            prevTokenRef={prevToken?.ref}
            nextTokenRef={nextToken?.ref}
          />
        </>
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
    }
  | {
      kind: 'superscript';
      /** Stable React key for this superscript. */
      key: string;
      /** The verse label to render (verbatim number, or `chapter:number` at a chapter transition). */
      label: string;
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
        />
      );
    }
    if (item.kind === 'superscript') {
      return <VerseSuperscript key={item.key} label={item.label} />;
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
