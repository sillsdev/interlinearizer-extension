/** @file Shared phrase-box wrapper used around word tokens. */
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  usePhraseLinkForToken,
} from './AnalysisStore';
import { usePhraseStripContext } from './PhraseStripContext';
import MemoizedTokenChip, { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import { sortByDocOrder } from '../utils/phrase-arc';
import { NO_SLOT_FOCUS } from '../utils/token-layout';

/**
 * Inline gloss input for a phrase. Reads and writes the phrase-level gloss from the analysis store.
 * Separated into its own component so hooks are always called unconditionally.
 *
 * @param props - Component props
 * @param props.phraseId - ID of the `PhraseAnalysis` to read/write.
 * @param props.disabled - When true, the input is read-only.
 * @param props.onFocus - Called when the input receives focus; used to center this phrase in the
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
      className="tw:gloss-input"
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
  /** Whether this phrase is the current navigation focus. */
  isFocused: boolean;
  /** Key identifying this phrase group, forwarded to `onFocusPhrase`. */
  groupKey: string;
  /**
   * Called with `groupKey` when any child gloss input receives focus, so the parent can focus this
   * phrase.
   */
  onFocusPhrase: (groupKey: string) => void;
  /** Word tokens belonging to this phrase; must all have `type: 'word'`. */
  tokens: (Token & { type: 'word' })[];
  /** The approved `PhraseAnalysisLink` shared by all tokens in this box, if any. */
  phraseLink: PhraseAnalysisLink | undefined;
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
   * Token refs that would become free (solo) if the currently hovered split/unlink button were
   * clicked. Each matching chip renders with a destructive border as a preview; when every token in
   * the box is free (e.g. a single-token fragment), the whole box border turns destructive too.
   */
  splitFreeTokenRefs?: ReadonlySet<string>;
  /**
   * Punctuation tokens that appear between adjacent word tokens within this group, in document
   * order. `punctuationBetween[i]` contains punctuation between `tokens[i]` and `tokens[i+1]`. When
   * omitted or empty, no intra-phrase punctuation is rendered.
   */
  punctuationBetween?: Token[][];
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
 * @param props.isFocused - Whether this phrase is the current navigation focus
 * @param props.groupKey - Key identifying this phrase group, forwarded to `onFocusPhrase`
 * @param props.onFocusPhrase - Called with `groupKey` when any child gloss input receives focus
 * @param props.tokens - Tokens belonging to this phrase
 * @param props.phraseLink - Approved phrase link shared by all tokens in this box, if any
 * @param props.showGlossInput - When false, hides the gloss input; used for non-first fragments of
 *   a discontiguous phrase so the input appears only once
 * @param props.showControls - When true, edit/unlink buttons are shown above this fragment (parent
 *   sets for hovered fragment only)
 * @param props.isHighlighted - When true, all fragments of the hovered/focused phrase receive the
 *   highlighted border style simultaneously
 * @param props.splitFreeTokenRefs - Token refs that would become free after a hovered split; each
 *   matching chip renders with a destructive border as a preview
 * @returns A bordered inline container
 */
export function PhraseBox({
  isFocused = false,
  isHighlighted = false,
  splitFreeTokenRefs,
  punctuationBetween,
  groupKey,
  onFocusPhrase,
  tokens,
  phraseLink,
  showGlossInput = true,
  showControls = true,
}: PhraseBoxProps) {
  const {
    phraseMode,
    setPhraseMode,
    editPhraseTokens,
    editPhraseSegmentId,
    tokenSegmentMap,
    tokenDocOrder,
    simplifyPhrases,
  } = usePhraseStripContext();
  // When simplifyPhrases is on, a phrase exposes its interactive controls only while focused.
  // Intra-phrase unlink icons are hidden via opacity/pointer-events (not unmounted) so the layout
  // gap they occupy is preserved. The remove-token ✕ is omitted from onRemove instead (it only
  // appears as a prop-driven overlay, so omitting it has no layout impact).
  const controlsSuppressed = simplifyPhrases && !isFocused;
  const { updatePhrase, deletePhrase } = usePhraseDispatch();

  const tokenPhraseLinkFromStore = usePhraseLinkForToken(tokens[0].ref);
  const isInAnyPhrase = tokenPhraseLinkFromStore !== undefined;
  const isThisPhrase =
    phraseLink !== undefined && tokenPhraseLinkFromStore?.analysisId === phraseLink.analysisId;

  /** Notifies the parent when a child gloss input receives focus. */
  const handleFocus = useCallback(() => onFocusPhrase(groupKey), [groupKey, onFocusPhrase]);

  /**
   * Focuses the box's first gloss input when any non-interactive part of the box is clicked — the
   * bordered container, the token-row wrapper spans, the padding, or the gloss area around the
   * input. Each token chip's own input/button handles its own focus, so clicks that land directly
   * on one of those are left alone (the `closest` check); everything else is treated as "click the
   * phrase" and forwards focus to the first gloss input, which fires its `onFocus` →
   * {@link onFocusPhrase} and so highlights this phrase. This is what makes clicking the body of a
   * phrase box (not just a chip) select it; without it, such clicks fell through to the segment
   * background handler, which focused the segment's first phrase instead.
   *
   * @param e - The container's click event.
   */
  const focusFirstGlossOnSelfClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('input, button, a, label')) return;
    e.currentTarget.querySelector('input')?.focus();
  }, []);

  /**
   * Keyboard counterpart to {@link focusFirstGlossOnSelfClick} so the click-target container
   * satisfies the interactive-element a11y rule. Enter/Space focus the first gloss input. The box
   * itself is `tabIndex={-1}`, so this only fires for programmatic focus, never normal tabbing.
   *
   * @param e - The container's keydown event.
   */
  const focusFirstGlossOnSelfKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.currentTarget.querySelector('input')?.focus();
  }, []);

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
   * Pops a single token out of the phrase in view mode. When only one token remains after removal
   * the phrase is deleted entirely (the unlink button handles the two-token case explicitly, so
   * `onRemove` is only ever wired for middle tokens of 3+ token phrases).
   *
   * @param tokenRef - Ref of the token to remove.
   */
  const handleViewPopOut = useCallback(
    (tokenRef: string) => {
      /* v8 ignore next -- onRemove is only wired when isRealPhrase, guaranteeing phraseLink exists */
      if (!phraseLink) return;
      const nextTokens = phraseLink.tokens.filter((t) => t.tokenRef !== tokenRef);
      /* v8 ignore next 3 -- onRemove is only wired for middle tokens of 3+ token phrases */
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
      /* v8 ignore next -- only called from edit-target mode where phraseMode.kind is always 'edit' */
      if (phraseMode.kind !== 'edit' || !tokenPhraseLinkFromStore) return;
      const nextTokens = tokenPhraseLinkFromStore.tokens.filter((t) => t.tokenRef !== tokenRef);
      if (nextTokens.length === 0) return;
      updatePhrase(phraseMode.phraseId, nextTokens);
    },
    [phraseMode, tokenPhraseLinkFromStore, updatePhrase],
  );

  /**
   * Adds a free token to the phrase being edited, inserting it in document order so the stored
   * token list always matches the visual left-to-right order. Keeping the list sorted is required
   * for `splitPhraseAtBoundary` (and its hover previews), which slice the stored array by position
   * to determine the before/after fragments.
   *
   * @param tokenRef - Ref of the free token to add.
   * @param surfaceText - Surface text of that token.
   */
  const handleEditAdd = useCallback(
    (tokenRef: string, surfaceText: string) => {
      if (phraseMode.kind !== 'edit' || !editPhraseTokens) return;
      const nextTokens = sortByDocOrder(
        [...editPhraseTokens, { tokenRef, surfaceText }],
        tokenDocOrder,
      );
      updatePhrase(phraseMode.phraseId, nextTokens);
    },
    [phraseMode, editPhraseTokens, updatePhrase, tokenDocOrder],
  );

  const isRealPhrase = phraseLink !== undefined;

  // The pop-out (✕) guard below must compare against the phrase's first/last token in *document*
  // order, not stored order. The stored token list is kept sorted by all current write paths, but
  // we sort defensively here (matching `splitPhraseAtBoundary`) so legacy/unsorted data still places
  // the ✕ on the visually-first/last tokens rather than wherever they happen to sit in storage.
  const orderedPhraseRefs = phraseLink
    ? sortByDocOrder(phraseLink.tokens, tokenDocOrder).map((t) => t.tokenRef)
    : [];

  // The whole box previews as becoming free only when it is a lone single-token fragment that would
  // be freed (e.g. a one-token run of a discontiguous phrase). A multi-token box always reddens the
  // affected chips individually below, even when every token would be freed (a 2-token phrase
  // splits into two free tokens, but each is shown on its own chip rather than as a box).
  const isBoxSplitFree = tokens.length === 1 && (splitFreeTokenRefs?.has(tokens[0].ref) ?? false);

  if (phraseMode.kind === 'view') {
    const viewBorderClass = (() => {
      if (isBoxSplitFree) return 'tw:phrase-destructive';
      if (isFocused) return 'tw:phrase-focused';
      if (isHighlighted) return 'tw:phrase-hovered';
      return 'tw:phrase-dimmed';
    })();
    const baseClass = `tw:phrase-box-base ${viewBorderClass}`;

    return (
      <span className="tw:relative tw:inline-flex tw:flex-col">
        {isRealPhrase && showControls && (
          <span
            className="tw:absolute tw:top-0 tw:z-1 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-full tw:inline-flex tw:gap-0.5 tw:rounded tw:border tw:phrase-hovered tw:bg-background tw:px-0.5 tw:py-px"
            data-phrase-controls="true"
          >
            <button
              aria-label="Edit phrase"
              className="tw:rounded tw:px-0.5 tw:py-px tw:text-xs tw:text-muted-foreground tw:hover:text-foreground"
              data-testid="edit-phrase-btn"
              tabIndex={-1}
              onClick={handleEditClick}
              type="button"
            >
              ✎
            </button>
            <button
              aria-label="Unlink phrase"
              className="tw:rounded tw:px-0.5 tw:py-px tw:text-xs tw:text-muted-foreground tw:hover:text-destructive"
              data-testid="unlink-phrase-btn"
              tabIndex={-1}
              onClick={handleUnlinkClick}
              type="button"
            >
              <Trash2 className="tw:h-3 tw:w-3" />
            </button>
          </span>
        )}
        <div
          className={baseClass}
          data-focus-state={isFocused ? 'focused' : 'default'}
          data-last-token-ref={phraseLink ? tokens[tokens.length - 1].ref : undefined}
          data-phrase-box="true"
          data-phrase-id={phraseLink?.analysisId}
          onClick={focusFirstGlossOnSelfClick}
          onKeyDown={focusFirstGlossOnSelfKeyDown}
          role="button"
          tabIndex={-1}
        >
          <span className="tw:phrase-token-row">
            {tokens.map((token, i) => (
              <span key={token.ref} className="tw:phrase-token-row">
                {i > 0 && (
                  <span className="tw:inline-flex tw:flex-col tw:items-center">
                    {isRealPhrase && (
                      <span
                        aria-hidden={controlsSuppressed || undefined}
                        style={{
                          opacity: controlsSuppressed ? 0 : 1,
                          pointerEvents: controlsSuppressed ? 'none' : undefined,
                        }}
                      >
                        <MemoizedTokenLinkIcon
                          slotFocus={NO_SLOT_FOCUS}
                          isPhraseRevealed={isHighlighted}
                          nextPhraseLink={phraseLink}
                          nextToken={token}
                          prevPhraseLink={phraseLink}
                          prevToken={tokens[i - 1]}
                        />
                      </span>
                    )}
                    {punctuationBetween?.[i - 1] && punctuationBetween[i - 1].length > 0 && (
                      <span className="tw:inline-flex tw:flex-row tw:items-center">
                        {punctuationBetween[i - 1].map((p) => (
                          <InertTokenChip key={p.ref} token={p} />
                        ))}
                      </span>
                    )}
                  </span>
                )}
                <MemoizedTokenChip
                  isSplitFree={!isBoxSplitFree && (splitFreeTokenRefs?.has(token.ref) ?? false)}
                  onFocus={handleFocus}
                  onRemove={
                    !controlsSuppressed &&
                    isRealPhrase &&
                    isHighlighted &&
                    phraseLink.tokens.length > 2 &&
                    token.ref !== orderedPhraseRefs[0] &&
                    token.ref !== orderedPhraseRefs[orderedPhraseRefs.length - 1]
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
        </div>
      </span>
    );
  }

  if (phraseMode.kind === 'confirm-unlink') {
    const isThisUnlinkTarget = isRealPhrase && phraseLink.analysisId === phraseMode.phraseId;
    const baseClass = isThisUnlinkTarget
      ? 'tw:phrase-box-base tw:phrase-destructive'
      : 'tw:phrase-box-base tw:phrase-dimmed tw:opacity-40';

    return (
      <span className="tw:relative tw:inline-flex tw:flex-col">
        <div
          aria-disabled={isThisUnlinkTarget ? undefined : 'true'}
          className={baseClass}
          data-last-token-ref={phraseLink ? tokens[tokens.length - 1].ref : undefined}
          data-phrase-box="true"
          data-phrase-id={phraseLink?.analysisId}
        >
          <span className="tw:phrase-token-row">
            {tokens.map((token, i) => (
              <span key={token.ref} className="tw:phrase-token-row">
                {i > 0 && punctuationBetween?.[i - 1] && punctuationBetween[i - 1].length > 0 && (
                  <span className="tw:inline-flex tw:flex-row tw:items-center">
                    {punctuationBetween[i - 1].map((p) => (
                      <InertTokenChip key={p.ref} token={p} />
                    ))}
                  </span>
                )}
                <MemoizedTokenChip disabled onFocus={handleFocus} token={token} />
              </span>
            ))}
          </span>
          {isRealPhrase && showGlossInput && (
            <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
          )}
        </div>
      </span>
    );
  }

  const isInEditTarget = isThisPhrase && phraseLink?.analysisId === phraseMode.phraseId;

  const isInWrongSegment =
    !isInEditTarget &&
    editPhraseSegmentId !== undefined &&
    tokenSegmentMap.get(tokens[0].ref) !== editPhraseSegmentId;

  const isDisabled = (isInAnyPhrase && !isInEditTarget) || isInWrongSegment;

  const isSelected = isInEditTarget;

  const containerClass = (() => {
    if (isDisabled) return 'tw:phrase-box-base tw:phrase-dimmed tw:opacity-40';
    if (isSelected) return 'tw:phrase-box-base tw:border-ring tw:bg-muted/30';
    return 'tw:phrase-box-base tw:phrase-dimmed tw:cursor-pointer';
  })();

  if (isInEditTarget) {
    const handlePerTokenKeyDown = (tokenRef: string) => (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleEditRemove(tokenRef);
      }
    };
    return (
      <span
        className={containerClass}
        data-last-token-ref={tokens[tokens.length - 1].ref}
        data-phrase-box="true"
        data-phrase-id={phraseLink?.analysisId}
      >
        <span className="tw:phrase-token-row">
          {tokens.map((token, i) => (
            <span key={token.ref} className="tw:phrase-token-row">
              {i > 0 &&
                punctuationBetween?.[i - 1]?.map((p) => <InertTokenChip key={p.ref} token={p} />)}
              <span
                aria-label={`Remove ${token.surfaceText} from phrase`}
                className="tw:cursor-pointer tw:rounded tw:outline-none tw:focus:ring-2 tw:focus:ring-ring"
                role="button"
                tabIndex={-1}
                onClick={() => handleEditRemove(token.ref)}
                onKeyDown={handlePerTokenKeyDown(token.ref)}
              >
                <MemoizedTokenChip disabled onFocus={handleFocus} token={token} />
              </span>
            </span>
          ))}
        </span>
        {isRealPhrase && showGlossInput && (
          <PhraseGlossInput phraseId={phraseLink.analysisId} disabled />
        )}
      </span>
    );
  }

  const handleBoxClick = () => {
    /* v8 ignore next -- isDisabled box uses aria-disabled; keyboard focus is prevented */
    if (isDisabled) return;
    if (!isInAnyPhrase) handleEditAdd(tokens[0].ref, tokens[0].surfaceText);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleBoxClick();
    }
  };

  return (
    <span
      aria-disabled={isDisabled ? 'true' : undefined}
      className={containerClass}
      data-last-token-ref={phraseLink ? tokens[tokens.length - 1].ref : undefined}
      data-phrase-box="true"
      data-phrase-id={phraseLink?.analysisId}
      onClick={isDisabled ? undefined : handleBoxClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={-1}
    >
      <span className="tw:phrase-token-row">
        {tokens.map((token, i) => (
          <span key={token.ref} className="tw:phrase-token-row">
            {i > 0 &&
              punctuationBetween?.[i - 1]?.map((p) => <InertTokenChip key={p.ref} token={p} />)}
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

/** Memoized version of {@link PhraseBox}; use in render-stable phrase lists. */
const MemoizedPhraseBox = memo(PhraseBox);
export default MemoizedPhraseBox;
