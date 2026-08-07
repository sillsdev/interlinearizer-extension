import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { Trash2 } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { memo, useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { sortByDocOrder } from '../utils/phrase-arc';
import { NO_SLOT_FOCUS } from '../utils/token-layout';
import {
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  usePhraseLinkForToken,
  useReportGlossEditing,
} from './AnalysisStore';
import { usePhraseStripContext } from './PhraseStripContext';
import MemoizedTokenChip, { InertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';

/**
 * Inline gloss input for a phrase. Reads and writes the phrase-level gloss from the analysis store.
 * Separated into its own component so hooks are always called unconditionally. The placeholder
 * comes from strip context (fetched once per strip) rather than a per-instance
 * `useLocalizedStrings`, so the `field-sizing: content` input renders at its final width on its
 * first frame.
 */
function PhraseGlossInput({
  phraseId,
  disabled = false,
  onFocus,
}: Readonly<{
  /** ID of the `PhraseAnalysis` whose gloss is read and written. */
  phraseId: string;
  disabled?: boolean;
  /** Called when the input receives focus; used to center this phrase in the strip. */
  onFocus?: () => void;
}>) {
  const committed = usePhraseGloss(phraseId);
  const dispatchPhraseGloss = usePhraseGlossDispatch();
  const { glossPlaceholder, phraseGlossLabel } = usePhraseStripContext();
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Surface uncommitted typing to the unsaved indicator before the gloss commits on blur.
  useReportGlossEditing(!disabled && draft !== committed);

  return (
    <input
      aria-label={phraseGlossLabel}
      className="tw:mt-0.5 tw:gloss-input"
      data-testid="phrase-gloss-input"
      disabled={disabled}
      placeholder={glossPlaceholder}
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
   * When `true`, this box's tokens are part of a hovered operation preview — a link icon or a
   * boundary merge/split control whose candidate tokens would join into one phrase/segment or break
   * off into a new segment. Renders the strong `phrase-candidate` outline, visually distinct from
   * (and taking precedence over) the ordinary hover and focus styles.
   */
  isCandidate?: boolean;
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
 * - Tokens belonging to a _different_ phrase render disabled (grayed, `aria-disabled`, no click).
 * - Tokens in segments other than the edited phrase's segment also render disabled, enforcing the
 *   single-segment phrase invariant.
 * - Free tokens (not in any phrase) in the same segment render as click targets for adding them to
 *   the phrase.
 * - Each token chip within the target phrase is individually clickable to remove it.
 *
 * In `confirm-unlink` mode:
 *
 * - The phrase being unlinked is highlighted; all other phrase boxes are disabled.
 */
export function PhraseBox({
  isFocused = false,
  isHighlighted = false,
  isCandidate = false,
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
    showMorphology,
    glossPlaceholder,
    phraseEditLabel,
    phraseUnlinkLabel,
    removeTokenFromPhraseTemplate,
  } = usePhraseStripContext();
  // When simplifyPhrases is on, a phrase exposes its interactive controls only while focused.
  // Intra-phrase unlink icons are hidden via opacity/pointer-events (not unmounted) to preserve the
  // layout gap they occupy; the remove-token ✕ is omitted from onRemove instead (it's a prop-driven
  // overlay, so omitting it has no layout impact).
  const controlsSuppressed = simplifyPhrases && !isFocused;
  const { updatePhrase, deletePhrase } = usePhraseDispatch();

  const tokenPhraseLinkFromStore = usePhraseLinkForToken(tokens[0].ref);
  const isInAnyPhrase = tokenPhraseLinkFromStore !== undefined;
  const isThisPhrase =
    phraseLink !== undefined && tokenPhraseLinkFromStore?.analysisId === phraseLink.analysisId;

  /** Notifies the parent when a child gloss input receives focus. */
  const handleFocus = useCallback(() => onFocusPhrase(groupKey), [groupKey, onFocusPhrase]);

  /**
   * Focuses the box's first gloss input when any non-interactive part of the box is clicked (the
   * container, wrapper spans, padding, or gloss area), so clicking the phrase body — not just a
   * chip — selects it. Each token chip's own input/button handles its own focus, so clicks landing
   * directly on one are left alone (the `closest` check); everything else forwards focus to the
   * first gloss input, which reports the phrase as focused and highlights it. Focus is forwarded
   * with `preventScroll` because the clicked element is already on screen, so the browser's default
   * scroll-into-view would realign the segment list for no reason (the input may sit on another
   * wrapped row of the phrase, partially out of view). Morpheme gloss inputs are excluded from the
   * lookup: when morphology is shown they precede the token gloss input in DOM order, but a click
   * on the phrase body means "edit this phrase", so focus belongs in the first token's own gloss
   * field rather than in one of its morpheme sub-fields.
   */
  const focusFirstGlossOnSelfClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('input, button, a, label')) return;
    e.currentTarget
      .querySelector<HTMLInputElement>('input:not([data-morpheme-gloss])')
      ?.focus({ preventScroll: true });
  }, []);

  /**
   * Keyboard counterpart to the box's self-click focusing, so the click-target container satisfies
   * the interactive-element a11y rule. Enter/Space focus the first gloss input. The box itself is
   * `tabIndex={-1}`, so this only fires for programmatic focus, never normal tabbing.
   */
  const focusFirstGlossOnSelfKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLInputElement>('input:not([data-morpheme-gloss])')?.focus();
  }, []);

  /**
   * Enters phrase `edit` mode for this box's phrase, seeding the edit set with its current tokens
   * (kept as `originalTokens` so the edit can be diffed or canceled). No-op when this box has no
   * real phrase link.
   */
  const handleEditClick = useCallback(() => {
    if (phraseLink)
      setPhraseMode({
        kind: 'edit',
        phraseId: phraseLink.analysisId,
        originalTokens: phraseLink.tokens,
      });
  }, [phraseLink, setPhraseMode]);

  /**
   * Begins the unlink-confirmation flow for this box's phrase by switching to `confirm-unlink`
   * mode. No-op when this box has no real phrase link.
   */
  const handleUnlinkClick = useCallback(() => {
    if (phraseLink) setPhraseMode({ kind: 'confirm-unlink', phraseId: phraseLink.analysisId });
  }, [phraseLink, setPhraseMode]);

  /**
   * Pops a single token out of the phrase in view mode. When only one token remains after removal
   * the phrase is deleted entirely (the unlink button handles the two-token case explicitly, so
   * `onRemove` is only ever wired for middle tokens of 3+ token phrases).
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

  /** Removes a specific token from the phrase being edited. */
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

  // The pop-out (✕) guard below compares against the phrase's first/last token in *document* order,
  // not stored order. Sorted defensively here (matching `splitPhraseAtBoundary`) so unsorted data
  // still places the ✕ on the visually-first/last tokens rather than wherever they sit in storage.
  const orderedPhraseRefs = phraseLink
    ? sortByDocOrder(phraseLink.tokens, tokenDocOrder).map((t) => t.tokenRef)
    : [];

  // The whole box previews as becoming free only when it is a lone single-token fragment that would
  // be freed (e.g. a one-token run of a discontiguous phrase). A multi-token box reddens the
  // affected chips individually below, even when every token would be freed.
  const isBoxSplitFree = tokens.length === 1 && (splitFreeTokenRefs?.has(tokens[0].ref) ?? false);

  if (phraseMode.kind === 'view') {
    const viewBorderClass = (() => {
      if (isBoxSplitFree) return 'tw:phrase-destructive';
      // Candidate previews outrank focus/hover: while a preview is hovered, showing what the
      // operation affects matters more than showing what is focused.
      if (isCandidate) return 'tw:phrase-candidate';
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
            <Button
              aria-label={phraseEditLabel}
              className="tw:text-xs tw:text-muted-foreground tw:hover:text-foreground"
              data-testid="edit-phrase-btn"
              onClick={handleEditClick}
              size="icon-xs"
              tabIndex={-1}
              type="button"
              variant="ghost"
            >
              ✎
            </Button>
            <Button
              aria-label={phraseUnlinkLabel}
              className="tw:text-muted-foreground tw:hover:text-destructive"
              data-testid="unlink-phrase-btn"
              onClick={handleUnlinkClick}
              size="icon-xs"
              tabIndex={-1}
              type="button"
              variant="ghost"
            >
              <Trash2 className="tw:size-3" />
            </Button>
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
                  // Intra-phrasal (inter-token) gap column, stacked to match the inter-phrasal
                  // PhraseSlot column so the unlink icon and gap punctuation land at the same
                  // vertical offset whether the gap is inside a phrase box or between two: a
                  // fixed-height punctuation row first (so a gap carrying punctuation is exactly as
                  // tall as an empty one), then the unlink icon below it.
                  //
                  // The nudge is `mt-px` (1px), not the slot's `mt-1` (4px): the slot sits outside
                  // the box and clears its top border + `py-0.5` padding to reach the surface-text
                  // baseline, but this column already sits inside the box, below that 3px, so it
                  // needs only the remaining 1px.
                  <span className="tw:mt-px tw:inline-flex tw:flex-col tw:items-center">
                    <span className="tw:inline-flex tw:h-5 tw:flex-row tw:items-start tw:justify-center">
                      {punctuationBetween?.[i - 1] && punctuationBetween[i - 1].length > 0 && (
                        <span className="tw:inline-flex tw:flex-row tw:items-start">
                          {punctuationBetween[i - 1].map((p) => (
                            <InertTokenChip key={p.ref} token={p} />
                          ))}
                        </span>
                      )}
                    </span>
                    {isRealPhrase && (
                      <span
                        // `inline-flex` (matching the slot's icon wrapper) so the span hugs the icon
                        // at its exact 16px height; a bare inline span picks up line-box leading,
                        // adding dead space that pushes the unlink button below its inter-phrase
                        // counterpart.
                        className="tw:inline-flex"
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
                  </span>
                )}
                <MemoizedTokenChip
                  glossPlaceholder={glossPlaceholder}
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
                  removeLabelTemplate={removeTokenFromPhraseTemplate}
                  showMorphology={showMorphology}
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
                <MemoizedTokenChip
                  disabled
                  glossPlaceholder={glossPlaceholder}
                  onFocus={handleFocus}
                  showMorphology={showMorphology}
                  token={token}
                />
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
    /**
     * Builds a keydown handler that removes the given token from the edited phrase on Enter/Space,
     * so each token chip is removable via the keyboard as well as by click.
     */
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
                aria-label={removeTokenFromPhraseTemplate.replace(
                  '{token}',
                  () => token.surfaceText,
                )}
                className="tw:cursor-pointer tw:rounded tw:outline-none tw:focus:ring-2 tw:focus:ring-ring"
                role="button"
                tabIndex={-1}
                onClick={() => handleEditRemove(token.ref)}
                onKeyDown={handlePerTokenKeyDown(token.ref)}
              >
                <MemoizedTokenChip
                  disabled
                  glossPlaceholder={glossPlaceholder}
                  onFocus={handleFocus}
                  showMorphology={showMorphology}
                  token={token}
                />
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

  /**
   * Adds this box's lone free token to the phrase being edited; no-op when the box is disabled or
   * its token already belongs to a phrase.
   */
  const handleBoxClick = () => {
    /* v8 ignore next -- isDisabled box uses aria-disabled; keyboard focus is prevented */
    if (isDisabled) return;
    if (!isInAnyPhrase) handleEditAdd(tokens[0].ref, tokens[0].surfaceText);
  };

  /**
   * Keyboard counterpart to clicking the box: Enter/Space add this box's free token to the edited
   * phrase, ignored while the box is disabled.
   */
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
            <MemoizedTokenChip
              disabled
              glossPlaceholder={glossPlaceholder}
              onFocus={handleFocus}
              showMorphology={showMorphology}
              token={token}
            />
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
