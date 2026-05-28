/** @file Shared phrase-box wrapper used around word tokens. */
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import {
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  usePhraseLinkForToken,
} from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';
import MemoizedTokenChip from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';

/**
 * Inline gloss input for a phrase. Reads and writes the phrase-level gloss from the analysis store.
 * Separated into its own component so hooks are always called unconditionally.
 *
 * @param props - Component props
 * @param props.phraseId - ID of the `PhraseAnalysis` to read/write.
 * @param props.disabled - When true, the input is read-only.
 * @param props.onFocus - Called when the input receives focus; used to centre this phrase in the
 *   strip.
 * @returns An input element sized to its content.
 */
function PhraseGlossInput({
  phraseId,
  disabled = false,
  onFocus,
}: Readonly<{ phraseId: string; disabled?: boolean; onFocus?: () => void }>) {
  const committed = usePhraseGloss(phraseId);
  const dispatchPhraseGloss = usePhraseGlossDispatch();
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <input
      aria-label="Phrase gloss"
      className="tw:mt-0.5 tw:block tw:w-full tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring tw:disabled:opacity-50 tw:disabled:cursor-default"
      data-testid="phrase-gloss-input"
      disabled={disabled}
      placeholder="gloss"
      style={{ fieldSizing: 'content' }}
      type="text"
      value={draft}
      onBlur={() => {
        if (!disabled && draft !== committed) dispatchPhraseGloss(phraseId, draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
    />
  );
}

/** Props for {@link PhraseBox}. */
type PhraseBoxProps = Readonly<{
  /** Index passed back to `onFocusPhrase` to identify which phrase gained focus. */
  index: number | undefined;
  /** Whether this phrase is the current navigation focus. */
  isFocused: boolean;
  /** Called with `index` when any child gloss input receives focus. */
  onFocusPhrase: (index?: number) => void;
  /** Word tokens belonging to this phrase; must all have `type: 'word'`. */
  tokens: (Token & { type: 'word' })[];
  /** The approved `PhraseAnalysisLink` shared by all tokens in this box, if any. */
  phraseLink: PhraseAnalysisLink | undefined;
  /** Current phrase-interaction mode; controls rendering and click behavior. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; used to enter edit / confirm-unlink modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /**
   * In `edit` mode only: the current token list of the phrase being edited, passed in from the
   * parent so a free token can append itself to it without needing store access here.
   */
  editPhraseTokens?: PhraseAnalysisLink['tokens'];
  /**
   * In `edit` mode only: the segmentId of the phrase being edited. Tokens in any other segment are
   * disabled to enforce the single-segment phrase invariant.
   */
  editPhraseSegmentId?: string;
  /**
   * Map from token ref to its owning segment id; used by `edit` mode to disable tokens outside the
   * phrase's segment.
   */
  tokenSegmentMap?: ReadonlyMap<string, string>;
  /**
   * Distance in pixels above the box top to push the controls pill, so it aligns with the arc's
   * flat top rather than floating directly above the box. Defaults to `0`.
   */
  arcOffsetPx?: number;
  /**
   * When `false`, the phrase gloss input is hidden even if this box has a real phrase link. Used
   * for non-first fragments of a discontiguous phrase so the gloss input appears only once.
   * Defaults to `true`.
   */
  showGlossInput?: boolean;
  /**
   * When `true`, the edit/unlink buttons are shown above this box. The parent passes this only for
   * the fragment currently being hovered, so controls float above whichever fragment the pointer is
   * over rather than always appearing above the first fragment.
   */
  showControls?: boolean;
  /**
   * When `true`, this box belongs to the phrase that is currently hovered or focused anywhere in
   * the view. All fragments of that phrase receive the highlighted style simultaneously.
   */
  isHighlighted?: boolean;
  /**
   * When `true`, this token/box would become a free (solo) token if the currently hovered
   * split/unlink button were clicked. Renders with a destructive border as a preview.
   */
  isSplitFree?: boolean;
}>;

/**
 * Wraps one or more tokens in a phrase-level visual container.
 *
 * In `view` mode:
 *
 * - Real phrases (with a `phraseLink`) show "Edit phrase" and "Unlink phrase" icon buttons.
 * - Solo tokens render as the normal gloss-editable chip.
 *
 * In `edit` mode:
 *
 * - Tokens belonging to the active target phrase render with a "selected" outline.
 * - Tokens belonging to a _different_ phrase render disabled (greyed, `aria-disabled`, no click).
 * - Tokens in segments other than the edited phrase's segment also render disabled, enforcing the
 *   single-segment phrase invariant.
 * - Free tokens (not in any phrase) in the same segment render as click targets for adding them to
 *   the phrase.
 * - Each token chip within the target phrase is individually clickable to remove it.
 *
 * In `confirm-unlink` mode:
 *
 * - The phrase being unlinked is highlighted; all other phrase boxes are disabled.
 *
 * @param props - Component props
 * @param props.index - Index passed back to `onFocusPhrase` to identify which phrase was focused
 * @param props.isFocused - Whether this phrase is the current navigation focus
 * @param props.onFocusPhrase - Called with `index` when any child gloss input receives focus
 * @param props.tokens - Tokens belonging to this phrase
 * @param props.phraseLink - Approved phrase link shared by all tokens in this box, if any
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.editPhraseTokens - Current token list of the phrase being edited (edit mode only)
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited (edit mode only)
 * @param props.tokenSegmentMap - Token ref → segment id lookup used in edit mode
 * @param props.arcOffsetPx - Extra upward offset for the controls pill so it sits at the arc top
 * @param props.showControls - When true, edit/unlink buttons are shown above this fragment (parent
 *   sets for hovered fragment only)
 * @returns A bordered inline container
 */
export function PhraseBox({
  index,
  isFocused = false,
  isHighlighted = false,
  isSplitFree = false,
  onFocusPhrase,
  tokens,
  phraseLink,
  phraseMode,
  setPhraseMode,
  editPhraseTokens,
  editPhraseSegmentId,
  tokenSegmentMap,
  arcOffsetPx = 0,
  showGlossInput = true,
  showControls = true,
}: PhraseBoxProps) {
  const { updatePhrase, deletePhrase } = usePhraseDispatch();

  // For the first token: look up phrase membership to check if it's in any phrase (incl. another).
  // Solo boxes only have one token; multi-token boxes share a phraseLink so we look up tok[0].
  const tokenPhraseLinkFromStore = usePhraseLinkForToken(tokens[0].ref);
  const isInAnyPhrase = tokenPhraseLinkFromStore !== undefined;
  const isThisPhrase =
    phraseLink !== undefined && tokenPhraseLinkFromStore?.analysisId === phraseLink.analysisId;

  /** Notifies the parent when a child gloss input receives focus. */
  const handleFocus = useCallback(() => onFocusPhrase(index), [onFocusPhrase, index]);

  const handleEditClick = useCallback(() => {
    if (phraseLink)
      setPhraseMode({
        kind: 'edit',
        phraseId: phraseLink.analysisId,
        originalTokens: phraseLink.tokens,
      });
  }, [phraseLink, setPhraseMode]);

  const handleUnlinkClick = useCallback(() => {
    if (phraseLink) setPhraseMode({ kind: 'confirm-unlink', phraseId: phraseLink.analysisId });
  }, [phraseLink, setPhraseMode]);

  /**
   * Pops a single token out of the phrase in view mode. When only two tokens remain after removal
   * the phrase is deleted entirely (the unlink button handles the two-token case explicitly).
   *
   * @param tokenRef - Ref of the token to remove.
   */
  const handleViewPopOut = useCallback(
    (tokenRef: string) => {
      if (!phraseLink) return;
      const nextTokens = phraseLink.tokens.filter((t) => t.tokenRef !== tokenRef);
      if (nextTokens.length <= 1) {
        deletePhrase(phraseLink.analysisId);
      } else {
        updatePhrase(phraseLink.analysisId, nextTokens);
      }
    },
    [phraseLink, updatePhrase, deletePhrase],
  );

  /**
   * Removes a specific token from the phrase being edited.
   *
   * @param tokenRef - Ref of the token to remove from the phrase.
   */
  const handleEditRemove = useCallback(
    (tokenRef: string) => {
      if (phraseMode.kind !== 'edit' || !tokenPhraseLinkFromStore) return;
      const nextTokens = tokenPhraseLinkFromStore.tokens.filter((t) => t.tokenRef !== tokenRef);
      updatePhrase(phraseMode.phraseId, nextTokens);
    },
    [phraseMode, tokenPhraseLinkFromStore, updatePhrase],
  );

  /**
   * Adds a free token to the phrase being edited.
   *
   * @param tokenRef - Ref of the free token to add.
   * @param surfaceText - Surface text of that token.
   */
  const handleEditAdd = useCallback(
    (tokenRef: string, surfaceText: string) => {
      if (phraseMode.kind !== 'edit' || !editPhraseTokens) return;
      updatePhrase(phraseMode.phraseId, [...editPhraseTokens, { tokenRef, surfaceText }]);
    },
    [phraseMode, editPhraseTokens, updatePhrase],
  );

  // When revert:true is set, the first token of the phrase being edited restores originalTokens.
  const isFirstEditToken =
    phraseMode.kind === 'edit' &&
    phraseMode.revert === true &&
    isThisPhrase &&
    tokens[0].ref === phraseLink?.tokens[0]?.tokenRef;
  useEffect(() => {
    if (!isFirstEditToken || phraseMode.kind !== 'edit') return;
    updatePhrase(phraseMode.phraseId, phraseMode.originalTokens);
    setPhraseMode({ kind: 'view' });
    // phraseMode identity changes on each revert signal; only re-run when the flag flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstEditToken]);

  const isRealPhrase = phraseLink !== undefined;

  // --- view mode ---
  if (phraseMode.kind === 'view') {
    const viewBorderClass = (() => {
      if (isSplitFree) return 'tw:border-destructive tw:bg-muted/20';
      if (isFocused) return 'tw:border-white tw:bg-muted/30';
      if (isHighlighted) return 'tw:border-white/55 tw:bg-muted/25';
      return 'tw:border-border/40 tw:bg-muted/20';
    })();
    const baseClass = `tw:inline-flex tw:flex-col tw:rounded tw:border ${viewBorderClass} tw:px-0.5 tw:py-0.5`;

    // The pill is centred on the arc top. To keep controls reachable while the pointer moves up
    // through the gap between the box and the pill, extend the transparent span all the way to the
    // pill's top edge: arcOffsetPx (box-to-arc distance) + CONTROLS_HALF_HEIGHT_PX (half pill).
    const hoverZoneHeightPx = arcOffsetPx + 10; // 10 = CONTROLS_HALF_HEIGHT_PX

    return (
      <span className="tw:relative tw:inline-flex tw:flex-col">
        {isRealPhrase && showControls && (
          <span
            aria-hidden="true"
            className="tw:absolute tw:left-0 tw:right-0"
            style={{ top: `-${hoverZoneHeightPx}px`, height: `${hoverZoneHeightPx}px` }}
          />
        )}
        {isRealPhrase && showControls && (
          <span
            className="tw:absolute tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2 tw:inline-flex tw:gap-0.5 tw:rounded tw:border tw:border-border/40 tw:bg-background tw:px-0.5 tw:py-px"
            data-phrase-controls="true"
            style={{ top: `-${arcOffsetPx}px` }}
          >
            <button
              aria-label="Edit phrase"
              className="tw:rounded tw:px-0.5 tw:py-px tw:text-xs tw:text-muted-foreground tw:hover:text-foreground"
              data-testid="edit-phrase-btn"
              onClick={handleEditClick}
              type="button"
            >
              ✎
            </button>
            <button
              aria-label="Unlink phrase"
              className="tw:rounded tw:px-0.5 tw:py-px tw:text-xs tw:text-muted-foreground tw:hover:text-destructive"
              data-testid="unlink-phrase-btn"
              onClick={handleUnlinkClick}
              type="button"
            >
              <Trash2 className="tw:h-3 tw:w-3" />
            </button>
          </span>
        )}
        <label
          className={baseClass}
          data-focus-state={isFocused ? 'focused' : 'default'}
          data-last-token-ref={phraseLink ? tokens[tokens.length - 1].ref : undefined}
          data-phrase-box="true"
          data-phrase-id={phraseLink?.analysisId}
        >
          <span className="tw:inline-flex tw:items-start tw:gap-1">
            {tokens.map((token, i) => (
              <span key={token.ref} className="tw:inline-flex tw:items-start tw:gap-1">
                {i > 0 && isRealPhrase && (
                  <MemoizedTokenLinkIcon
                    focusedFreeToken={undefined}
                    focusedPhraseLink={undefined}
                    focusedSideIsPrev={undefined}
                    isSameSegmentAsFocus={false}
                    isPhraseRevealed={isHighlighted}
                    nextPhraseLink={phraseLink}
                    nextToken={token}
                    phraseMode={phraseMode}
                    prevPhraseLink={phraseLink}
                    prevToken={tokens[i - 1]}
                  />
                )}
                <MemoizedTokenChip
                  onFocus={handleFocus}
                  onRemove={
                    isRealPhrase &&
                    isHighlighted &&
                    phraseLink.tokens.length > 2 &&
                    token.ref !== phraseLink.tokens[0].tokenRef &&
                    token.ref !== phraseLink.tokens[phraseLink.tokens.length - 1].tokenRef
                      ? () => handleViewPopOut(token.ref)
                      : undefined
                  }
                  token={token}
                />
              </span>
            ))}
          </span>
          {isRealPhrase && showGlossInput && (
            <PhraseGlossInput onFocus={handleFocus} phraseId={phraseLink.analysisId} />
          )}
        </label>
      </span>
    );
  }

  // --- confirm-unlink mode ---
  if (phraseMode.kind === 'confirm-unlink') {
    const isThisUnlinkTarget = isRealPhrase && phraseLink.analysisId === phraseMode.phraseId;
    const baseClass = isThisUnlinkTarget
      ? 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-destructive tw:bg-muted/30 tw:px-0.5 tw:py-0.5'
      : 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-0.5 tw:py-0.5 tw:opacity-40';

    return (
      <span className="tw:relative tw:inline-flex tw:flex-col">
        <label
          aria-disabled={isThisUnlinkTarget ? undefined : 'true'}
          className={baseClass}
          data-phrase-box="true"
          data-phrase-id={phraseLink?.analysisId}
        >
          <span className="tw:inline-flex tw:items-start tw:gap-1">
            {tokens.map((token) => (
              <MemoizedTokenChip key={token.ref} disabled onFocus={handleFocus} token={token} />
            ))}
          </span>
          {isRealPhrase && showGlossInput && (
            <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
          )}
        </label>
      </span>
    );
  }

  // --- edit mode ---

  const isInEditTarget = isThisPhrase && phraseLink?.analysisId === phraseMode.phraseId;

  // Tokens in a different segment from the phrase being edited are disabled to enforce the
  // single-segment phrase invariant.
  const isInWrongSegment =
    !isInEditTarget &&
    editPhraseSegmentId !== undefined &&
    tokenSegmentMap?.get(tokens[0].ref) !== editPhraseSegmentId;

  // Tokens that belong to a *different* phrase, or are outside the edited phrase's segment, are
  // disabled.
  const isDisabled = (isInAnyPhrase && !isInEditTarget) || isInWrongSegment;

  const isSelected = isInEditTarget;

  // Outer container style: disabled phrases fade out; selected (edit-target) gets a ring;
  // free tokens are clickable with a subtle border.
  const containerClass = (() => {
    if (isDisabled)
      return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/10 tw:px-0.5 tw:py-0.5 tw:opacity-40';
    if (isSelected)
      return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-ring tw:bg-muted/30 tw:px-0.5 tw:py-0.5';
    return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-0.5 tw:py-0.5 tw:cursor-pointer';
  })();

  // In edit mode with the target phrase: each token chip is individually clickable to remove it.
  if (isInEditTarget) {
    const handlePerTokenKeyDown = (tokenRef: string) => (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') handleEditRemove(tokenRef);
    };
    return (
      <span
        className={containerClass}
        data-phrase-box="true"
        data-phrase-id={phraseLink?.analysisId}
      >
        <span className="tw:inline-flex tw:items-start tw:gap-1">
          {tokens.map((token) => (
            <span
              key={token.ref}
              aria-label={`Remove ${token.surfaceText} from phrase`}
              className="tw:cursor-pointer tw:rounded tw:outline-none tw:focus:ring-2 tw:focus:ring-ring"
              role="button"
              tabIndex={0}
              onClick={() => handleEditRemove(token.ref)}
              onKeyDown={handlePerTokenKeyDown(token.ref)}
            >
              <MemoizedTokenChip disabled onFocus={handleFocus} token={token} />
            </span>
          ))}
        </span>
        {isRealPhrase && showGlossInput && (
          <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
        )}
      </span>
    );
  }

  // Free token in edit mode (or disabled phrase box).
  const handleBoxClick = () => {
    if (isDisabled) return;
    if (!isInAnyPhrase) handleEditAdd(tokens[0].ref, tokens[0].surfaceText);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) handleBoxClick();
  };

  return (
    <span
      aria-disabled={isDisabled ? 'true' : undefined}
      className={containerClass}
      data-phrase-box="true"
      data-phrase-id={phraseLink?.analysisId}
      onClick={isDisabled ? undefined : handleBoxClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
    >
      <span className="tw:inline-flex tw:items-start tw:gap-1">
        {tokens.map((token) => (
          <MemoizedTokenChip key={token.ref} disabled onFocus={handleFocus} token={token} />
        ))}
      </span>
      {isRealPhrase && showGlossInput && (
        <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
      )}
    </span>
  );
}

/** Memoized version of {@link PhraseBox}; use in render-stable phrase lists. */
const MemoizedPhraseBox = memo(PhraseBox);
export default MemoizedPhraseBox;
