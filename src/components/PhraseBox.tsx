/** @file Shared phrase-box wrapper used around word tokens. */
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { memo, useCallback, useEffect, useState } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import {
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  usePhraseLinkForToken,
} from './AnalysisStore';
import { DRAFT_PHRASE_ID, type PhraseMode } from './phrase-mode';
import MemoizedTokenChip from './TokenChip';

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
      style={{ fieldSizing: 'content', minWidth: '5ch' }}
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
}>;

/**
 * Wraps one or more tokens in a phrase-level visual container.
 *
 * In `view` mode:
 *
 * - Real phrases (with a `phraseLink`) show "Edit phrase" and "Unlink phrase" icon buttons.
 * - Solo tokens render as the normal gloss-editable chip.
 *
 * In `create` or `edit` mode:
 *
 * - Tokens belonging to the active draft / target phrase render with a "selected" outline.
 * - Tokens belonging to a _different_ phrase render disabled (greyed, `aria-disabled`, no click).
 * - Free tokens (not in any phrase) render as click targets for toggling draft membership.
 * - In `edit` mode, each token chip within the phrase is individually clickable to remove it; free
 *   tokens are clickable to add them to the phrase.
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
 * @param props.arcOffsetPx - Extra upward offset for the controls pill so it sits at the arc top
 * @param props.showControls - When true, edit/unlink buttons are shown above this fragment (parent
 *   sets for hovered fragment only)
 * @returns A bordered inline container
 */
export function PhraseBox({
  index,
  isFocused = false,
  isHighlighted = false,
  onFocusPhrase,
  tokens,
  phraseLink,
  phraseMode,
  setPhraseMode,
  editPhraseTokens,
  arcOffsetPx = 0,
  showGlossInput = true,
  showControls = true,
}: PhraseBoxProps) {
  const { createPhrase: dispatchCreatePhrase, updatePhrase } = usePhraseDispatch();
  const dispatchPhraseGloss = usePhraseGlossDispatch();

  /** Gloss typed by the user before the draft phrase is committed. */
  const [draftGloss, setDraftGloss] = useState('');

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
   * Toggles a specific token's membership in create mode (adds/removes from draft). In edit mode
   * this is used only for the box-level click when the box is a single free token.
   *
   * @param tokenRef - Ref of the token to toggle.
   */
  const handleCreateToggle = useCallback(
    (tokenRef: string) => {
      if (phraseMode.kind !== 'create') return;
      const alreadyInDraft = phraseMode.draftTokenRefs.includes(tokenRef);
      const nextDraft = alreadyInDraft
        ? phraseMode.draftTokenRefs.filter((r) => r !== tokenRef)
        : [...phraseMode.draftTokenRefs, tokenRef];
      setPhraseMode({ kind: 'create', draftTokenRefs: nextDraft });
    },
    [phraseMode, setPhraseMode],
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

  /** Commits the draft as a new phrase and returns to view mode. */
  const handleDone = useCallback(() => {
    /* v8 ignore next 4 -- Done button only renders when isInDraft; guard is defensive */
    if (phraseMode.kind !== 'create' || phraseMode.draftTokenRefs.length < 2) {
      setPhraseMode({ kind: 'view' });
      return;
    }
    const newId = dispatchCreatePhrase(
      phraseMode.draftTokenRefs.map((r) => ({
        tokenRef: r,
        /* v8 ignore next -- draft refs always match tokens in the owning PhraseBox */
        surfaceText: tokens.find((t) => t.ref === r)?.surfaceText ?? r,
      })),
    );
    if (draftGloss) dispatchPhraseGloss(newId, draftGloss);
    setPhraseMode({ kind: 'view' });
  }, [phraseMode, dispatchCreatePhrase, dispatchPhraseGloss, draftGloss, tokens, setPhraseMode]);

  // When the toolbar sets commit:true, the first PhraseBox that contains a draft token fires handleDone.
  const isFirstDraftToken =
    phraseMode.kind === 'create' &&
    phraseMode.commit === true &&
    phraseMode.draftTokenRefs[0] === tokens[0].ref;
  useEffect(() => {
    if (isFirstDraftToken) handleDone();
    // handleDone is stable; isFirstDraftToken captures the commit signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstDraftToken]);

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

  const isRealPhrase = phraseLink !== undefined && phraseLink.analysisId !== DRAFT_PHRASE_ID;

  // --- view mode ---
  if (phraseMode.kind === 'view') {
    const baseClass =
      isFocused || isHighlighted
        ? 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-white tw:bg-muted/30 tw:px-0.5 tw:py-0.5'
        : 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-0.5 tw:py-0.5';

    return (
      <span className="tw:relative tw:inline-flex tw:flex-col">
        {isRealPhrase && showControls && (
          <span
            aria-hidden="true"
            className="tw:absolute tw:left-1/2 tw:-translate-x-1/2 tw:w-8"
            style={{ top: `-${arcOffsetPx}px`, height: `${arcOffsetPx}px` }}
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
              ✕
            </button>
          </span>
        )}
        <label
          className={baseClass}
          data-focus-state={isFocused ? 'focused' : 'default'}
          data-phrase-box="true"
          data-phrase-id={phraseLink?.analysisId}
        >
          <span className="tw:inline-flex tw:items-start tw:gap-1">
            {tokens.map((token) => (
              <MemoizedTokenChip key={token.ref} onFocus={handleFocus} token={token} />
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

  // --- create / edit mode ---

  // In create mode: determine if this token is in the active draft.
  const isInDraft =
    phraseMode.kind === 'create' && phraseMode.draftTokenRefs.includes(tokens[0].ref);

  // In edit mode: determine if this token belongs to the phrase being edited.
  const isInEditTarget =
    phraseMode.kind === 'edit' && isThisPhrase && phraseLink?.analysisId === phraseMode.phraseId;

  // Tokens that belong to a *different* phrase are disabled.
  const isDisabled =
    isInAnyPhrase &&
    !(
      (phraseMode.kind === 'create' && isInDraft) ||
      (phraseMode.kind === 'edit' && isInEditTarget)
    );

  const isSelected = isInDraft || isInEditTarget;

  // Outer container style: disabled phrases fade out; selected (draft/edit-target) get a ring;
  // free tokens are clickable with a subtle border.
  const containerClass = (() => {
    if (isDisabled)
      return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/10 tw:px-0.5 tw:py-0.5 tw:opacity-40';
    if (isSelected)
      return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-ring tw:bg-muted/30 tw:px-0.5 tw:py-0.5';
    return 'tw:inline-flex tw:flex-col tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-0.5 tw:py-0.5 tw:cursor-pointer';
  })();

  // In edit mode with the target phrase, or in create mode with a multi-token draft group:
  // each token chip is individually clickable to remove it.
  if (
    (phraseMode.kind === 'edit' && isInEditTarget) ||
    (phraseMode.kind === 'create' && isInDraft && tokens.length > 1)
  ) {
    const handlePerTokenKeyDown = (tokenRef: string) => (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (phraseMode.kind === 'edit') handleEditRemove(tokenRef);
        else handleCreateToggle(tokenRef);
      }
    };
    const handlePerTokenClick = (tokenRef: string) => {
      if (phraseMode.kind === 'edit') handleEditRemove(tokenRef);
      else handleCreateToggle(tokenRef);
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
              aria-label={
                phraseMode.kind === 'edit'
                  ? `Remove ${token.surfaceText} from phrase`
                  : `Deselect ${token.surfaceText}`
              }
              className="tw:cursor-pointer tw:rounded tw:outline-none tw:focus:ring-2 tw:focus:ring-ring"
              role="button"
              tabIndex={0}
              onClick={() => handlePerTokenClick(token.ref)}
              onKeyDown={handlePerTokenKeyDown(token.ref)}
            >
              <MemoizedTokenChip disabled onFocus={handleFocus} token={token} />
            </span>
          ))}
        </span>
        {isRealPhrase && showGlossInput && (
          <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
        )}
        {phraseMode.kind === 'create' && showGlossInput && (
          <input
            aria-label="Phrase gloss"
            className="tw:mt-0.5 tw:block tw:w-full tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring"
            data-testid="draft-phrase-gloss-input"
            style={{ fieldSizing: 'content', minWidth: '5ch' }}
            type="text"
            value={draftGloss}
            onChange={(e) => setDraftGloss(e.target.value)}
          />
        )}
      </span>
    );
  }

  // Free token in edit mode, single draft token in create mode, or disabled phrase box.
  const handleBoxClick = () => {
    if (isDisabled) return;
    if (phraseMode.kind === 'create') {
      handleCreateToggle(tokens[0].ref);
    } else if (phraseMode.kind === 'edit' && !isInAnyPhrase) {
      handleEditAdd(tokens[0].ref, tokens[0].surfaceText);
    }
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
