/** @file Inline link / unlink icon rendered between adjacent word token groups. */
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { Link2, Link2Off } from 'lucide-react';
import { memo, useCallback } from 'react';
import { usePhraseDispatch } from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';

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
   * Whether the currently focused token/phrase is on the prev (start) side of this icon. `true` =
   * focused group is start-ward of this slot; `false` = focused group is end-ward; `undefined` = no
   * focus set. When `true`, clicking joins the end-side (next) token/phrase into the focused
   * start-side. When `false`, clicking joins the start-side (prev) token/phrase into the focused
   * end-side.
   */
  focusedSideIsPrev: boolean | undefined;
  /**
   * The phrase link of the currently focused token, if any. Used to correctly identify the focused
   * phrase when the focus is not immediately adjacent to this slot.
   */
  focusedPhraseLink: PhraseAnalysisLink | undefined;
  /**
   * The focused word token itself (free token, not in any phrase), or `undefined` when the focused
   * token is inside a phrase (use `focusedPhraseLink` instead) or there is no focus.
   */
  focusedFreeToken: (Token & { type: 'word' }) | undefined;
  /**
   * Whether both neighbors of this slot are in the same segment as the focused token/phrase. When
   * `false`, the link button is disabled because phrases must stay within a single segment.
   */
  isSameSegmentAsFocus: boolean;
  /**
   * Whether the surrounding phrase is currently hovered or focused — used to reveal the unlink
   * icon.
   */
  isPhraseRevealed: boolean;
  /** Current phrase-interaction mode; controls visibility and disabled state of the icons. */
  phraseMode: PhraseMode;
  /**
   * Called when the pointer enters this icon with the phraseId of the phrase that would be affected
   * (linked or unlinked), or `undefined` when the pointer leaves. The parent uses this to highlight
   * the relevant phrase box and arcs.
   */
  onHoverCandidatePhrase?: (phraseId: string | undefined) => void;
  /**
   * Called when the pointer enters an active link icon that would create a new phrase from two free
   * tokens, with the token refs of both tokens that would be joined. Called with `undefined` on
   * mouse leave. Only fires when both sides are free tokens and the link would create a new
   * phrase.
   *
   * @param tokenRefs - Refs of the two tokens that would be joined, or `undefined` on leave.
   */
  onHoverCandidateTokens?: (tokenRefs: readonly string[] | undefined) => void;
  /**
   * Called when the pointer enters an unlink icon that would leave one or more tokens solo (free),
   * with the refs of those tokens. Called with `undefined` on mouse leave. Used by the parent to
   * show a red (destructive) border on tokens that would become free after the split.
   *
   * @param tokenRefs - Refs of tokens that would become solo, or `undefined` on leave.
   */
  onHoverSplitFreeTokens?: (tokenRefs: readonly string[] | undefined) => void;
  /**
   * Map from token ref to its flat document index. Used to keep merged phrase token lists in
   * document order after a link operation. Must cover every token that could appear in a phrase.
   *
   * Defaults to an empty map; only needed for slots that can trigger link (not intra-phrase
   * unlink).
   */
  tokenDocOrder?: ReadonlyMap<string, number>;
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
  focusedSideIsPrev,
  focusedPhraseLink,
  focusedFreeToken,
  isSameSegmentAsFocus,
  isPhraseRevealed,
  phraseMode,
  onHoverCandidatePhrase,
  onHoverCandidateTokens,
  onHoverSplitFreeTokens,
  tokenDocOrder = new Map(),
}: TokenLinkIconProps) {
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

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
   * Sorts a token snapshot list by document order using `tokenDocOrder`.
   *
   * @param snapshots - Token snapshots to sort.
   * @returns A new array sorted by ascending document index.
   */
  const sortByDocOrder = useCallback(
    (snapshots: PhraseAnalysisLink['tokens']): PhraseAnalysisLink['tokens'] => {
      return [...snapshots].sort(
        /* v8 ignore next -- ?? 0 fallback for tokens not in tokenDocOrder; always provided in practice */
        (a, b) => (tokenDocOrder.get(a.tokenRef) ?? 0) - (tokenDocOrder.get(b.tokenRef) ?? 0),
      );
    },
    [tokenDocOrder],
  );

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

    // The neighbor is the token/phrase on the opposite side of this slot from focus.
    const neighborLink = focusedSideIsPrev ? nextPhraseLink : prevPhraseLink;
    const neighborToken = focusedSideIsPrev ? nextToken : prevToken;
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
          sortByDocOrder([...focusedPhraseLink.tokens, bridgingSnapshot]),
        );
        return;
      }

      // Focused token is in a phrase: merge the neighbor's token(s) into the focused phrase,
      // then sort the combined list into document order.
      const neighborSnapshots = neighborLink
        ? neighborLink.tokens
        : [{ tokenRef: neighborToken.ref, surfaceText: neighborToken.surfaceText }];
      updatePhrase(
        focusedPhraseLink.analysisId,
        sortByDocOrder([...focusedPhraseLink.tokens, ...neighborSnapshots]),
      );
      if (neighborLink) deletePhrase(neighborLink.analysisId);
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
        sortByDocOrder([...neighborLink.tokens, focusedSnapshot]),
      );
      return;
    }

    // Both sides are free tokens: create a two-token phrase in document order.
    const neighborSnapshot = {
      tokenRef: neighborToken.ref,
      surfaceText: neighborToken.surfaceText,
    };
    createPhrase(sortByDocOrder([focusedSnapshot, neighborSnapshot]));
  }, [
    prevToken,
    nextToken,
    prevPhraseLink,
    nextPhraseLink,
    focusedSideIsPrev,
    focusedPhraseLink,
    focusedFreeToken,
    sortByDocOrder,
    createPhrase,
    updatePhrase,
    deletePhrase,
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
      const tokens = [...prevPhraseLink.tokens].sort(
        (a, b) => (tokenDocOrder.get(a.tokenRef) ?? 0) - (tokenDocOrder.get(b.tokenRef) ?? 0),
      );
      const boundaryIndex = tokens.findIndex((t) => t.tokenRef === prevToken.ref) + 1;
      const before = tokens.slice(0, boundaryIndex);
      const after = tokens.slice(boundaryIndex);
      const freeRefs: string[] = [];
      if (before.length === 1) freeRefs.push(before[0].tokenRef);
      if (after.length === 1) freeRefs.push(after[0].tokenRef);
      return freeRefs.length > 0 ? freeRefs : undefined;
    })();

    const handleUnlinkMouseEnter = () => {
      if (candidatePhraseId) onHoverCandidatePhrase?.(candidatePhraseId);
      if (splitFreeRefs) onHoverSplitFreeTokens?.(splitFreeRefs);
    };
    const handleUnlinkMouseLeave = () => {
      if (candidatePhraseId) onHoverCandidatePhrase?.(undefined);
      if (splitFreeRefs) onHoverSplitFreeTokens?.(undefined);
    };
    // Clear hover state synchronously with the click so the red "would become free" border doesn't
    // linger after the split until the next mouse move.
    const handleUnlinkClickWithCleanup = () => {
      handleUnlinkMouseLeave();
      handleUnlinkClick();
    };

    return (
      <button
        aria-label="Unlink tokens"
        className={`tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 tw:transition-opacity tw:hover:text-destructive tw:focus:opacity-100 tw:disabled:pointer-events-none tw:disabled:opacity-30 ${isPhraseRevealed ? 'tw:text-muted-foreground tw:opacity-100' : 'tw:text-muted-foreground/20 tw:opacity-100'}`}
        data-testid="token-unlink-btn"
        disabled={unlinkDisabled}
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

  // Link icon: active in view mode when focus is set and both neighbors are in the same segment.
  const isActive =
    phraseMode.kind === 'view' && focusedSideIsPrev !== undefined && isSameSegmentAsFocus;
  const linkDisabled = isUnlinkMode || isEditMode || !isActive;

  // Highlight exactly what would be absorbed if the button were clicked — mirrors handleLinkClick.
  // Uses onHoverCandidateTokens (token-ref based) in all cases so only the directly adjacent
  // fragment/box is highlighted, never all fragments of a discontiguous phrase.
  const neighborRef = (focusedSideIsPrev ? nextToken : prevToken)?.ref;
  const neighborLink = focusedSideIsPrev ? nextPhraseLink : prevPhraseLink;
  const bridgingToken = focusedSideIsPrev ? prevToken : nextToken;
  const neighborIsPhrase = focusedSideIsPrev ? !!nextPhraseLink : !!prevPhraseLink;
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
    if (candidateTokenRefs) onHoverCandidateTokens?.(candidateTokenRefs);
  };

  const handleLinkMouseLeave = () => {
    if (candidateTokenRefs) onHoverCandidateTokens?.(undefined);
  };

  return (
    <button
      aria-label="Link tokens"
      className={`tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:p-0.5 ${isActive ? 'tw:text-muted-foreground/50 tw:hover:text-foreground' : 'tw:text-muted-foreground/20 tw:cursor-default'}`}
      data-testid="token-link-btn"
      disabled={linkDisabled}
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
