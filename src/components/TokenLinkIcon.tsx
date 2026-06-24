/** @file Inline link / unlink icon rendered between adjacent word token groups. */
import type { PhraseAnalysisLink, Segment, Token } from 'interlinearizer';
import { Link2, Link2Off } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { usePhraseDispatch } from './AnalysisStore';
import { usePhraseStripContext } from './PhraseStripContext';
import { useSegmentation } from './SegmentationStore';
import type { SlotFocusInfo } from '../types/token-layout';
import { isWordToken } from '../types/type-guards';
import { computeSplitFreeRefs, sortByDocOrder, splitPhraseAtBoundary } from '../utils/phrase-arc';

/**
 * A resolved "reach past verse 0" link target. When the segment adjacent to a cross-segment slot is
 * a verse-0 superscription, the link can't pull the superscription's own token (its tokens must
 * stay together); instead it reaches past verse 0 to the next real segment. Acting on it sweeps
 * verse 0 wholesale into the focused segment and pulls {@link beyondToken} across, so the new phrase
 * lands in one segment.
 */
type VerseZeroSkip = Readonly<{
  /** First-token ref of the verse-0 segment, removed to merge it into the focused segment. */
  verseZeroStartRef: string;
  /** The real link/pull target: the first word past verse 0 (forward) or last word before it. */
  beyondToken: Token & { type: 'word' };
  /** The segment containing {@link beyondToken}. */
  beyondSeg: Segment;
  /** The phrase containing {@link beyondToken}, if any. */
  beyondPhraseLink: PhraseAnalysisLink | undefined;
}>;

/** Props for {@link TokenLinkIcon}. */
type TokenLinkIconProps = Readonly<{
  /** The last word token of the group immediately before this slot, if any. */
  prevToken: (Token & { type: 'word' }) | undefined;
  /** The first word token of the group immediately after this slot, if any. */
  nextToken: (Token & { type: 'word' }) | undefined;
  /** Phrase link containing `prevToken`'s group, if any. */
  prevPhraseLink: PhraseAnalysisLink | undefined;
  /** Phrase link containing `nextToken`'s group, if any. */
  nextPhraseLink: PhraseAnalysisLink | undefined;
  /**
   * The bundle of focus-derived inputs for this slot: link direction (`focusedSideIsPrev`),
   * single-segment validity (`isSameSegmentAsFocus`), and the focused phrase/free token used to
   * resolve cross-slot link targets. Built by `resolveSlotFocus` for real slots, or `NO_SLOT_FOCUS`
   * for the in-phrase unlink icons rendered by `PhraseBox`.
   */
  slotFocus: SlotFocusInfo;
  /**
   * Whether the surrounding phrase is currently hovered or focused — used to reveal the unlink
   * icon.
   */
  isPhraseRevealed: boolean;
}>;

/**
 * Renders a small icon between two adjacent word token groups.
 *
 * When both sides belong to the same phrase, renders `Link2Off` (unlink): clicking splits the
 * phrase at this boundary. Visible only when `isPhraseRevealed` (phrase hovered or focused).
 *
 * Otherwise renders `Link2` (link): clicking joins the non-focused-side neighbor to the focused
 * side. The icon is active whenever `focusedSideIsPrev` is defined and the resulting join is valid.
 * Both icon types are suppressed (return `undefined`) when neither side has a word token.
 *
 * **Link semantics** (`focusedSideIsPrev` determines direction; only active when both neighbors are
 * in the same segment as focus):
 *
 * - Focused start-ward, free next → append next token to focused phrase (or create new phrase).
 * - Focused end-ward, free prev → prepend prev token to focused phrase (or create new phrase).
 * - Either side already in a phrase → not supported via simple click (both-phrases case).
 *
 * **Unlink semantics** (both sides same phrase):
 *
 * - Both halves ≥ 2 tokens → split into two phrases.
 * - One half = 1 token → that token leaves the phrase; the other half keeps/shrinks the phrase.
 * - Both halves = 1 token → delete the phrase entirely.
 *
 * @param props - Component props
 * @returns A button-styled icon, or `undefined` when the slot has no adjacent word tokens.
 */
export function TokenLinkIcon({
  prevToken,
  nextToken,
  prevPhraseLink,
  nextPhraseLink,
  slotFocus,
  isPhraseRevealed,
}: TokenLinkIconProps) {
  const {
    focusedSideIsPrev,
    focusedPhraseLink,
    focusedFreeToken,
    isSameSegmentAsFocus,
    isAdjacentEdgeOfFocus,
  } = slotFocus;
  const {
    phraseMode,
    tokenDocOrder,
    tokenSegmentMap,
    phraseLinkByRef,
    onHoverPhrase: onHoverCandidatePhrase,
    onHoverCandidateTokens,
    onHoverSplitFreeTokens,
    crossSegmentLinkTooltip,
  } = usePhraseStripContext();
  const { createPhrase, updatePhrase, deletePhrase, mergePhrases } = usePhraseDispatch();
  const {
    dispatch: segmentationDispatch,
    segmentById,
    segmentOrder,
    verseZeroSegmentIds,
  } = useSegmentation();

  /**
   * When the segment on the far (non-focused) side of this slot is a verse-0 superscription, the
   * resolved target past it; otherwise `undefined`. Drives the "reach past verse 0" link: the
   * superscription is swept into the focused segment as an intact unit and {@link beyondToken} is
   * pulled across, rather than splitting the superscription.
   */
  const verseZeroSkip = useMemo<VerseZeroSkip | undefined>(() => {
    if (focusedSideIsPrev === undefined || !prevToken || !nextToken) return undefined;
    const neighborToken = focusedSideIsPrev ? nextToken : prevToken;
    const verseZeroSegId = tokenSegmentMap.get(neighborToken.ref);
    if (verseZeroSegId === undefined || !verseZeroSegmentIds.has(verseZeroSegId)) return undefined;
    const verseZeroIndex = segmentOrder.get(verseZeroSegId);
    /* v8 ignore next -- a verse-0 segment id always appears in segmentOrder (same source book) */
    if (verseZeroIndex === undefined) return undefined;
    // Reach to the real segment beyond verse 0 in the pull direction.
    const beyondIndex = focusedSideIsPrev ? verseZeroIndex + 1 : verseZeroIndex - 1;
    let beyondSeg: Segment | undefined;
    segmentOrder.forEach((index, id) => {
      if (index === beyondIndex) beyondSeg = segmentById.get(id);
    });
    if (!beyondSeg) return undefined;
    // Forward pulls the first word after verse 0; backward pulls the last word before it.
    const beyondToken = focusedSideIsPrev
      ? beyondSeg.tokens.find(isWordToken)
      : [...beyondSeg.tokens].reverse().find(isWordToken);
    /* v8 ignore next -- a real segment beyond verse 0 always contains at least one word token */
    if (!beyondToken) return undefined;
    const verseZeroStartRef = segmentById.get(verseZeroSegId)?.tokens[0]?.ref;
    /* v8 ignore next -- a verse-0 segment resolved from a rendered slot always has a first token */
    if (verseZeroStartRef === undefined) return undefined;
    return {
      verseZeroStartRef,
      beyondToken,
      beyondSeg,
      beyondPhraseLink: phraseLinkByRef.get(beyondToken.ref),
    };
  }, [
    focusedSideIsPrev,
    prevToken,
    nextToken,
    tokenSegmentMap,
    verseZeroSegmentIds,
    segmentOrder,
    segmentById,
    phraseLinkByRef,
  ]);

  const inSamePhrase =
    prevPhraseLink !== undefined &&
    nextPhraseLink !== undefined &&
    prevPhraseLink.analysisId === nextPhraseLink.analysisId;

  /** Splits the shared phrase at the boundary between `prevToken` and `nextToken`. */
  const handleUnlinkClick = useCallback(() => {
    /* v8 ignore next -- button only renders when inSamePhrase and both tokens are defined */
    if (!inSamePhrase || !prevPhraseLink || !prevToken) return;
    splitPhraseAtBoundary(
      prevPhraseLink,
      prevToken.ref,
      {
        createPhrase,
        updatePhrase,
        deletePhrase,
      },
      tokenDocOrder,
    );
  }, [
    inSamePhrase,
    prevPhraseLink,
    prevToken,
    updatePhrase,
    createPhrase,
    deletePhrase,
    tokenDocOrder,
  ]);

  /**
   * Moves the segment boundary at this slot so the pulled edge token joins the focused token's
   * segment, when this is a cross-segment adjacent-edge link. The pulled token is the neighbor on
   * the far side of the slot; moving the boundary by one token keeps both segments contiguous.
   *
   * `focusedSideIsPrev = true`: focus is the previous (left) segment; `nextToken` is the adjacent
   * segment's first word, so the boundary moves forward to the token after it. `false`: focus is
   * the next (right) segment; `prevToken` is the previous segment's last word, so the boundary
   * moves back to start at it.
   */
  const performBoundaryPull = useCallback(() => {
    /* v8 ignore next -- only invoked from handleLinkClick after the same defined-token guards */
    if (!prevToken || !nextToken) return;
    if (verseZeroSkip) {
      // Sweep the whole superscription into the focused segment (it travels intact), then pull the
      // token beyond it so the new cross-superscription phrase lands in one segment.
      segmentationDispatch.merge(verseZeroSkip.verseZeroStartRef);
      if (focusedSideIsPrev) {
        const seg = verseZeroSkip.beyondSeg;
        const currentStart = seg.tokens[0]?.ref;
        /* v8 ignore next -- a reachable beyond segment always has at least one token */
        if (currentStart === undefined) return;
        const index = seg.tokens.findIndex((t) => t.ref === verseZeroSkip.beyondToken.ref);
        const newStart = seg.tokens[index + 1]?.ref;
        // The segment beyond verse 0 had only the pulled token, so it merges in wholly.
        if (newStart === undefined) segmentationDispatch.merge(currentStart);
        else segmentationDispatch.move(currentStart, newStart);
      } else {
        const focusedSegId = tokenSegmentMap.get(nextToken.ref);
        /* v8 ignore next -- a rendered backward slot's next token always maps to the focused segment */
        const focusedSeg = focusedSegId === undefined ? undefined : segmentById.get(focusedSegId);
        const currentStart = focusedSeg?.tokens[0]?.ref;
        /* v8 ignore next -- the focused segment of a rendered slot always has a first token */
        if (currentStart === undefined) return;
        segmentationDispatch.move(currentStart, verseZeroSkip.beyondToken.ref);
      }
      return;
    }
    const adjacentSegmentId = tokenSegmentMap.get(nextToken.ref);
    const adjacentSegment =
      adjacentSegmentId === undefined ? undefined : segmentById.get(adjacentSegmentId);
    if (!adjacentSegment) return;
    const currentStart = adjacentSegment.tokens[0]?.ref;
    /* v8 ignore next -- a rendered segment always has at least one token */
    if (currentStart === undefined) return;
    if (focusedSideIsPrev) {
      const index = adjacentSegment.tokens.findIndex((t) => t.ref === nextToken.ref);
      const newStart = adjacentSegment.tokens[index + 1]?.ref;
      // The adjacent segment had only the pulled token, so it merges wholly into the focused one.
      if (newStart === undefined) segmentationDispatch.merge(currentStart);
      else segmentationDispatch.move(currentStart, newStart);
    } else {
      segmentationDispatch.move(currentStart, prevToken.ref);
    }
  }, [
    prevToken,
    nextToken,
    focusedSideIsPrev,
    tokenSegmentMap,
    segmentById,
    segmentationDispatch,
    verseZeroSkip,
  ]);

  /**
   * Joins the neighbor on the far side of this slot into the focused phrase (or free token).
   *
   * `focusedSideIsPrev = true`: focus is prev-ward; the neighbor to join is
   * `nextToken`/`nextPhraseLink`. `focusedSideIsPrev = false`: focus is next-ward; the neighbor to
   * join is `prevToken`/`prevPhraseLink`.
   *
   * `focusedPhraseLink` is the phrase containing the focused token — it may be several slots away,
   * so we use it directly rather than reading `prevPhraseLink`/`nextPhraseLink` for the focused
   * side.
   *
   * `focusedFreeToken` is the focused token itself when it is not in any phrase, so that cross-slot
   * link creation uses the actual focused token rather than the adjacent slot token.
   *
   * Special case: when the neighbor is a different fragment of the focused phrase itself (e.g.
   * focused is A in phrase [A,C] and this slot is between free token B and C), the "neighbor" link
   * has the same analysisId as `focusedPhraseLink`. In that case the token on the focused side of
   * the slot (the bridging free token between the two fragments) is absorbed into the phrase.
   */
  const handleLinkClick = useCallback(() => {
    /* v8 ignore next -- button only renders when both tokens exist and focus is defined */
    if (!prevToken || !nextToken || focusedSideIsPrev === undefined) return;

    // For a cross-segment edge link, first move the boundary so the pulled token joins the focused
    // segment; the phrase mutation below then proceeds as for a within-segment link.
    if (isAdjacentEdgeOfFocus) performBoundaryPull();

    // The neighbor is the token/phrase on the opposite side of this slot from focus — or, when
    // reaching past a verse-0 superscription, the resolved target beyond it.
    const slotNeighborLink = focusedSideIsPrev ? nextPhraseLink : prevPhraseLink;
    const slotNeighborToken = focusedSideIsPrev ? nextToken : prevToken;
    const neighborLink = verseZeroSkip ? verseZeroSkip.beyondPhraseLink : slotNeighborLink;
    const neighborToken = verseZeroSkip ? verseZeroSkip.beyondToken : slotNeighborToken;
    // The bridging token is on the focused side of this slot — the free token sitting between two
    // fragments of the focused phrase when the neighbor IS the focused phrase.
    const bridgingToken = focusedSideIsPrev ? prevToken : nextToken;

    if (focusedPhraseLink) {
      // When the neighbor is a different fragment of the same phrase, absorb the bridging free
      // token between the two fragments rather than re-merging the phrase with itself.
      if (neighborLink?.analysisId === focusedPhraseLink.analysisId) {
        const bridgingSnapshot = {
          tokenRef: bridgingToken.ref,
          surfaceText: bridgingToken.surfaceText,
        };
        updatePhrase(
          focusedPhraseLink.analysisId,
          sortByDocOrder([...focusedPhraseLink.tokens, bridgingSnapshot], tokenDocOrder),
        );
        return;
      }

      // Focused token is in a phrase: merge the neighbor's token(s) into the focused phrase, then
      // sort the combined list into document order. Use a single atomic merge so no save observes
      // the intermediate state where an absorbed neighbor phrase's tokens belong to two phrases.
      const neighborSnapshots = neighborLink
        ? neighborLink.tokens
        : [{ tokenRef: neighborToken.ref, surfaceText: neighborToken.surfaceText }];
      mergePhrases(
        focusedPhraseLink.analysisId,
        sortByDocOrder([...focusedPhraseLink.tokens, ...neighborSnapshots], tokenDocOrder),
        neighborLink?.analysisId,
      );
      return;
    }

    // Focused token is free. Use the explicitly supplied focusedFreeToken so that this slot works
    // correctly even when the focused token is several slots away from this icon.
    if (!focusedFreeToken) return;
    const focusedSnapshot = {
      tokenRef: focusedFreeToken.ref,
      surfaceText: focusedFreeToken.surfaceText,
    };

    if (neighborLink) {
      // Neighbor is a phrase: absorb the focused free token into it, sorted by document order.
      updatePhrase(
        neighborLink.analysisId,
        sortByDocOrder([...neighborLink.tokens, focusedSnapshot], tokenDocOrder),
      );
      return;
    }

    // Both sides are free tokens: create a two-token phrase in document order.
    const neighborSnapshot = {
      tokenRef: neighborToken.ref,
      surfaceText: neighborToken.surfaceText,
    };
    createPhrase(sortByDocOrder([focusedSnapshot, neighborSnapshot], tokenDocOrder));
  }, [
    prevToken,
    nextToken,
    prevPhraseLink,
    nextPhraseLink,
    focusedSideIsPrev,
    focusedPhraseLink,
    focusedFreeToken,
    isAdjacentEdgeOfFocus,
    performBoundaryPull,
    verseZeroSkip,
    tokenDocOrder,
    createPhrase,
    updatePhrase,
    mergePhrases,
  ]);

  if (!prevToken || !nextToken) return undefined;

  // In confirm-unlink mode link buttons are shown but fully disabled so layout is stable.
  const isUnlinkMode = phraseMode.kind === 'confirm-unlink';
  // In edit mode, unlink buttons for phrases other than the one being edited are disabled.
  const isEditMode = phraseMode.kind === 'edit';

  // The phrase to highlight when hovering this icon: the shared phrase (unlink) or whichever side
  // has a phrase (link). Used to light up the associated phrase box and arcs.
  const candidatePhraseId = inSamePhrase
    ? prevPhraseLink?.analysisId
    : (prevPhraseLink?.analysisId ?? nextPhraseLink?.analysisId);

  if (inSamePhrase) {
    const unlinkDisabled =
      isUnlinkMode || (isEditMode && prevPhraseLink?.analysisId !== phraseMode.phraseId);

    // Compute which tokens would become solo (free) after this split. A half with exactly 1 token
    // leaves that token unattached, so we preview that with a red border.
    const splitFreeRefs = (() => {
      /* v8 ignore next -- inSamePhrase branch guarantees prevPhraseLink and prevToken exist */
      if (!prevPhraseLink || !prevToken) return undefined;
      return computeSplitFreeRefs(prevPhraseLink, prevToken.ref, tokenDocOrder);
    })();

    const handleUnlinkMouseEnter = () => {
      if (candidatePhraseId) onHoverCandidatePhrase(candidatePhraseId);
      if (splitFreeRefs) onHoverSplitFreeTokens(splitFreeRefs);
    };
    // Only clear the split-free preview on leave; the phrase hover is owned by the PhraseGroup
    // wrapper span so hovering back over the box restores it without re-entry needed.
    const handleUnlinkMouseLeave = () => {
      if (splitFreeRefs) onHoverSplitFreeTokens(undefined);
    };
    // Clear hover state synchronously with the click so the red "would become free" border doesn't
    // linger after the split until the next mouse move.
    const handleUnlinkClickWithCleanup = () => {
      onHoverCandidatePhrase(undefined);
      handleUnlinkMouseLeave();
      handleUnlinkClick();
    };

    return (
      <button
        aria-label="Unlink tokens"
        className={`tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:transition-opacity tw:hover:text-destructive tw:focus:opacity-100 tw:disabled:pointer-events-none tw:disabled:opacity-30 ${isPhraseRevealed ? 'tw:text-muted-foreground tw:opacity-100' : 'tw:text-muted-foreground/50 tw:opacity-100'}`}
        data-testid="token-unlink-btn"
        disabled={unlinkDisabled}
        tabIndex={-1}
        onClick={unlinkDisabled ? undefined : handleUnlinkClickWithCleanup}
        /* v8 ignore next 2 -- candidatePhraseId is always defined in inSamePhrase path */
        onMouseEnter={(candidatePhraseId ?? splitFreeRefs) ? handleUnlinkMouseEnter : undefined}
        onMouseLeave={(candidatePhraseId ?? splitFreeRefs) ? handleUnlinkMouseLeave : undefined}
        type="button"
      >
        <Link2Off className="tw:h-3 tw:w-3" />
      </button>
    );
  }

  // The focused token's segment, and whether it is itself a verse-0 superscription — foreign tokens
  // must never be pulled into a superscription, so its edges can't host a cross-segment pull.
  const focusedRef = focusedFreeToken?.ref ?? focusedPhraseLink?.tokens[0]?.tokenRef;
  const focusedSegmentId = focusedRef === undefined ? undefined : tokenSegmentMap.get(focusedRef);
  const focusedIsVerseZero =
    focusedSegmentId !== undefined && verseZeroSegmentIds.has(focusedSegmentId);
  // Whether the adjacent (non-focused) segment is a verse-0 superscription.
  const adjacentSegmentId =
    focusedSideIsPrev === undefined
      ? undefined
      : tokenSegmentMap.get((focusedSideIsPrev ? nextToken : prevToken).ref);
  const adjacentIsVerseZero =
    adjacentSegmentId !== undefined && verseZeroSegmentIds.has(adjacentSegmentId);
  // A cross-segment (adjacent-edge) pull is valid unless focus sits inside a superscription, or the
  // adjacent segment is a superscription with no real segment reachable beyond it (no skip target).
  const adjacentEdgeValid =
    isAdjacentEdgeOfFocus &&
    !focusedIsVerseZero &&
    (!adjacentIsVerseZero || verseZeroSkip !== undefined);

  // Link icon: active in view mode when focus is set and either both neighbors are in the focused
  // segment (a within-segment link) or this slot is a valid adjacent edge of the focused segment (a
  // cross-segment link that pulls the edge token across and moves the boundary, reaching past a
  // verse-0 superscription when one sits between).
  const isActive =
    phraseMode.kind === 'view' &&
    focusedSideIsPrev !== undefined &&
    (isSameSegmentAsFocus || adjacentEdgeValid);
  const linkDisabled = isUnlinkMode || isEditMode || !isActive;
  // Show a tooltip only when inactive because the slot is a cross-segment slot that cannot host a
  // link (not when disabled for other reasons like unlink/edit mode, where the reason is already
  // visible in the UI).
  const crossSegmentDisabled =
    phraseMode.kind === 'view' &&
    focusedSideIsPrev !== undefined &&
    !isSameSegmentAsFocus &&
    !adjacentEdgeValid;
  const linkTitle = crossSegmentDisabled ? crossSegmentLinkTooltip : undefined;

  // Highlight exactly what would be absorbed if the button were clicked — mirrors handleLinkClick.
  // Uses onHoverCandidateTokens (token-ref based) in all cases so only the directly adjacent
  // fragment/box is highlighted, never all fragments of a discontiguous phrase. When reaching past a
  // verse-0 superscription, the neighbor is the resolved target beyond it.
  const slotNeighborToken = focusedSideIsPrev ? nextToken : prevToken;
  const slotNeighborLink = focusedSideIsPrev ? nextPhraseLink : prevPhraseLink;
  const neighborRef = (verseZeroSkip ? verseZeroSkip.beyondToken : slotNeighborToken)?.ref;
  const neighborLink = verseZeroSkip ? verseZeroSkip.beyondPhraseLink : slotNeighborLink;
  const bridgingToken = focusedSideIsPrev ? prevToken : nextToken;
  const neighborIsPhrase = verseZeroSkip ? !!verseZeroSkip.beyondPhraseLink : !!slotNeighborLink;
  const neighborIsFocusedPhrase =
    neighborIsPhrase && neighborLink?.analysisId === focusedPhraseLink?.analysisId;
  const candidateTokenRefs = (() => {
    if (!isActive || !neighborRef) return undefined;
    // Both sides free: highlight both.
    if (!neighborIsPhrase && focusedFreeToken) return [focusedFreeToken.ref, neighborRef];
    // Focus is a phrase, neighbor is free: highlight the neighbor.
    if (!neighborIsPhrase && focusedPhraseLink) return [neighborRef];
    // Focus is free, neighbor is a phrase: highlight the focused token and all phrase tokens.
    if (neighborIsPhrase && focusedFreeToken)
      return [
        focusedFreeToken.ref,
        /* v8 ignore next -- neighborLink is always non-null when neighborIsPhrase is true */
        ...(neighborLink ? neighborLink.tokens.map((t) => t.tokenRef) : [neighborRef]),
      ];
    // Neighbor is a different fragment of the focused phrase: highlight the bridging free token.
    if (neighborIsFocusedPhrase && bridgingToken) return [bridgingToken.ref];
    // Focus is a phrase, neighbor is a different phrase: highlight all of its tokens since the
    // entire phrase would be absorbed on click.
    if (neighborIsPhrase && neighborLink && focusedPhraseLink)
      return neighborLink.tokens.map((t) => t.tokenRef);
    return undefined;
  })();

  const handleLinkMouseEnter = () => {
    if (candidateTokenRefs) onHoverCandidateTokens(candidateTokenRefs);
  };

  const handleLinkMouseLeave = () => {
    if (candidateTokenRefs) onHoverCandidateTokens(undefined);
  };

  return (
    <button
      aria-label="Link tokens"
      className={`tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 ${isActive ? 'tw:text-foreground/60 tw:hover:text-foreground' : 'tw:text-foreground/20 tw:cursor-default'}`}
      data-testid="token-link-btn"
      disabled={linkDisabled}
      tabIndex={-1}
      title={linkTitle}
      onClick={isActive ? handleLinkClick : undefined}
      onMouseEnter={isActive ? handleLinkMouseEnter : undefined}
      onMouseLeave={isActive ? handleLinkMouseLeave : undefined}
      type="button"
    >
      <Link2 className="tw:h-3 tw:w-3" />
    </button>
  );
}

/** Memoized version of {@link TokenLinkIcon}; use in render-stable token rows. */
const MemoizedTokenLinkIcon = memo(TokenLinkIcon);
export default MemoizedTokenLinkIcon;
