import type { Token } from 'interlinearizer';
import { Plus, X } from 'lucide-react';
import { Button, Popover, PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import {
  type KeyboardEvent,
  memo,
  type MouseEventHandler,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { glossedSuggestionEntries } from '../utils/suggestion-engine';
import {
  useAnalysisLanguage,
  useApproveAnalysisDispatch,
  useGloss,
  useGlossDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemeResetLosesGlosses,
  useMorphemes,
  useReportGlossEditing,
  useResolvedTokenAnalysis,
  useShowSuggestions,
  useSuggestionAfterClearing,
} from './AnalysisStore';
import { MorphemeBox } from './MorphemeBox';
import { MorphemeBreakdownPopover } from './MorphemeEditor';
import { TOKEN_CHIP_LABEL_KEYS, type TokenChipLabels } from './PhraseStripContext';
import SuggestionDropdown from './SuggestionDropdown';

/**
 * A thin space appended to the italic suggested placeholder. Faked italic leans glyphs right past
 * their advances, and the input clips at the content box that `field-sizing: content` fits to the
 * text run, so only widening that run makes room — CSS padding sits outside the clip. The lean is
 * rightward whatever the script, and bidi resets a trailing neutral to the paragraph direction, so
 * an LTR-direction input puts this at the visual right for an RTL gloss too; what flips it to the
 * useless left edge is the input itself resolving to `dir="rtl"`, which RTL support has to answer
 * by making the pad leading. Only one edge is padded — padding both offsets the glyphs from the
 * suggestion rows they line up with.
 */
const SUGGESTED_PLACEHOLDER_PAD = '\u2009';

/**
 * Renders a single word token as an inline chip with an editable gloss input below the surface
 * text. The gloss value and the dispatch that writes it both come from context, so the chip must be
 * rendered under an {@link AnalysisStoreProvider}. The gloss is written to the store only on blur,
 * and only when the draft differs from the committed value, to avoid creating empty analysis
 * entries on focus/blur cycles with no edits.
 *
 * When `showMorphology` is true, the morpheme breakdown is shown below the surface text. For
 * analyzed tokens this is a boxed grid ({@link MorphemeBox}) aligning each morpheme form over its
 * gloss field; for unanalyzed tokens it is a muted "define breakdown" button showing the surface
 * text. Clicking either opens an inline popover where the user can define, edit, or reset the
 * morpheme breakdown.
 *
 * @param props.token - The word token to render.
 * @param props.onFocus - Called when this token takes focus — its gloss input or one of its
 *   morpheme gloss inputs receives focus, or its morpheme breakdown editor is opened.
 * @param props.disabled - When true, the gloss input is read-only and non-interactive.
 * @param props.onRemove - When provided, renders a small X button in the top-right corner of the
 *   chip; clicking it calls this callback to remove the token from its phrase.
 * @param props.removeLabelTemplate - Accessible label for that X button, with `{token}` still to be
 *   substituted for the surface text.
 * @param props.isSplitFree - When true, this token would become free (solo) if the currently
 *   hovered split/unlink button were clicked; previewed with a destructive border on the chip.
 * @param props.showMorphology - When true, morpheme breakdown and per-morpheme glosses are shown
 *   below the surface text.
 * @param props.glossPlaceholder - Placeholder for the gloss input, resolved once per strip and
 *   passed down. Passed as a prop rather than read from context so the chip's memoization keeps
 *   shielding it from unrelated context churn.
 * @param props.labels - This chip's accessible labels, resolved once per strip. Passed as a prop
 *   rather than read from context so the chip's memoization keeps shielding it from unrelated
 *   context churn. Defaults to the unresolved keys, which is what a chip shows until its strip's
 *   lookup lands.
 */
export function TokenChip({
  token,
  onFocus,
  disabled = false,
  onRemove,
  removeLabelTemplate = '',
  isSplitFree = false,
  showMorphology = false,
  glossPlaceholder = '',
  labels = TOKEN_CHIP_LABEL_KEYS,
}: Readonly<{
  token: Token & { type: 'word' };
  onFocus: () => void;
  disabled?: boolean;
  onRemove?: () => void;
  removeLabelTemplate?: string;
  isSplitFree?: boolean;
  showMorphology?: boolean;
  glossPlaceholder?: string;
  labels?: TokenChipLabels;
}>) {
  const committedGloss = useGloss(token.ref);
  const onGlossChange = useGlossDispatch();
  const morphemes = useMorphemes(token.ref);
  const analysisLanguage = useAnalysisLanguage();
  const dispatchMorphemeBreakdown = useMorphemeBreakdownDispatch();
  const dispatchMorphemeDelete = useMorphemeDeleteDispatch();
  const resetLosesGlosses = useMorphemeResetLosesGlosses(token.ref);
  const showSuggestions = useShowSuggestions();
  // Only resolve the pool when suggestions are actually shown; off, this does no per-token lookup.
  const resolved = useResolvedTokenAnalysis(token.ref, token.surfaceText, showSuggestions);
  const approveAnalysis = useApproveAnalysisDispatch();
  const [draft, setDraft] = useState(committedGloss);
  // While the user has emptied an approved token's gloss, the deletion only commits on blur, so the
  // store still reports the token as approved. Preview the post-commit suggestion now — derived as
  // if this token's approval were already gone — so the row and ghost placeholder stay consistent
  // across the blur. Gated to the one token being cleared so no other chip does the extra lookup.
  const clearingApprovedGloss =
    showSuggestions && !disabled && resolved?.status === 'approved' && draft === '';
  const clearedSuggestion = useSuggestionAfterClearing(
    token.ref,
    token.surfaceText,
    clearingApprovedGloss,
  );
  const suggestionSource = clearingApprovedGloss ? clearedSuggestion : resolved;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const glossInputId = useId();
  const glossInputRef = useRef<HTMLInputElement | undefined>(undefined);
  // The suggestion combobox: an `activeIndex` of -1 means no row is highlighted, so a bare Enter
  // commits the top suggestion. Focusing (clicking) the gloss opens the dropdown whenever the token
  // has suggestions, and typing closes it again (it reopens when the field is emptied or via
  // ArrowDown). The "+" button is shown only for a token with more than one suggestion, as both a
  // marker that alternatives exist and a re-summon affordance over typed text; `inputFocused` /
  // `chipHovered` gate its visibility.
  const listboxId = useId();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const [chipHovered, setChipHovered] = useState(false);
  // Tracks whether the X button itself is hovered, so only that button hover reddens the border.
  const [isRemoveHovered, setIsRemoveHovered] = useState(false);
  // Reset remove-hover state when onRemove is cleared so the red border doesn't linger.
  const prevOnRemoveRef = useRef(onRemove);
  useEffect(() => {
    if (prevOnRemoveRef.current !== onRemove) {
      prevOnRemoveRef.current = onRemove;
      if (!onRemove && isRemoveHovered) setIsRemoveHovered(false);
    }
  }, [onRemove, isRemoveHovered]);

  // Keep local draft in sync when the committed value changes externally (e.g. project switch).
  useEffect(() => {
    setDraft(committedGloss);
  }, [committedGloss]);

  // Surface uncommitted typing to the unsaved indicator before the gloss commits on blur.
  useReportGlossEditing(!disabled && draft !== committedGloss);

  // Clear popover-open state when the morpheme row unmounts (showMorphology off), since it lives on
  // the chip and would otherwise survive to silently reopen the popover when morphology returns.
  // Also close it when the chip becomes disabled: the popover content renders on `popoverOpen`
  // alone (not gated on `disabled`), so an open popover would otherwise stay editable.
  useEffect(() => {
    if (!showMorphology || disabled) setPopoverOpen(false);
  }, [showMorphology, disabled]);

  /**
   * Intercepts mouse-down on the gloss input to suppress the browser's built-in focus-and-scroll,
   * then re-focuses the input with `preventScroll` so only the React-controlled smooth
   * scrollIntoView fires.
   */
  const handleMouseDown: MouseEventHandler<HTMLInputElement> = (e) => {
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
  };

  /**
   * Intercepts mouse-down on the chip's label so the label's native focus-forwarding (with the
   * browser's default scroll-into-view) can never scroll the list under the click. Focuses the
   * input directly with `preventScroll` instead; the native forwarding then finds it already
   * focused and does nothing. The input is looked up by id, not `querySelector('input')`, because
   * the morpheme gloss inputs precede it inside the label when morphology is shown. A mouse-down on
   * any input is left to that input's own handling; a mouse-down on the first morpheme form cell or
   * the unanalyzed "define" trigger (both `button`s) is left to that button's own click handler.
   * The remaining morpheme form cells are `span`s that stop their own mousedown from bubbling
   * here.
   */
  const handleLabelMouseDown: MouseEventHandler<HTMLLabelElement> = (e) => {
    if (e.target instanceof Element && e.target.closest('input, button')) return;
    e.preventDefault();
    document.getElementById(glossInputId)?.focus({ preventScroll: true });
  };

  /**
   * Opens the morpheme breakdown editor, first reporting this token as focused. Nothing in the
   * morpheme row moves focus into the chip otherwise — the trigger is a `button`, and a mouse-down
   * on a button is deliberately left to that button, while the remaining form cells stop their own
   * mouse-down — so without this the editor would float over a token the rest of the view still
   * treats as unfocused: the phrase highlight, arcs, and scroll position would stay on whichever
   * token was focused before, and would only catch up once the user clicked the chip again.
   */
  const openMorphemeEditor = () => {
    onFocus();
    setPopoverOpen(true);
  };

  /** Commits the morpheme breakdown from the popover input, splitting on whitespace. */
  const handleMorphemeSave = (value: string) => {
    const forms = value.split(/\s+/).filter(Boolean);
    if (forms.length > 0) {
      dispatchMorphemeBreakdown(token.ref, token.surfaceText, forms, token.writingSystem);
    }
  };

  const hasMorphemes = morphemes.length > 0;

  // Pool entries for the suggestion dropdown: for a suggested token, the top pick (blue "accept")
  // plus candidates (grey "promote"); for an approved token, the pool alternatives only (the
  // already-approved payload excluded) — or, while that approved gloss is being cleared, the
  // post-deletion preview from `suggestionSource`. Blank-in-active-language entries are dropped.
  // Memoized on the (reference-stable) source read and active language so typing a non-empty gloss
  // never re-runs the flatten/filter; clearing the field swaps `suggestionSource` and recomputes.
  const glossedRanked = useMemo(
    () => glossedSuggestionEntries(suggestionSource, analysisLanguage),
    [suggestionSource, analysisLanguage],
  );
  // Whether this token has anything to suggest: gated on the demo toggle (via the resolve short-
  // circuit) and editability. The dropdown only ever appears when this is true.
  const hasSuggestions = showSuggestions && !disabled && glossedRanked.length > 0;
  // The "+" button is offered only when there is a real choice — more than one suggestion. With a
  // single suggestion the ghost placeholder already advertises it and focusing the gloss opens the
  // dropdown to accept it, so a button would be redundant.
  const hasMultipleSuggestions = hasSuggestions && glossedRanked.length > 1;
  // Top pick (row 0, the blue "suggested") shown as ghost placeholder text so the row reveals
  // which tokens have a suggestion at a glance — without focus or hover. Once the user types, the
  // typed value replaces it.
  const suggestedGloss = hasSuggestions ? glossedRanked[0].gloss : undefined;
  const showSuggestedPlaceholder = suggestedGloss !== undefined && draft === '';

  /**
   * Returns the listbox option id for `index`; kept in sync with `aria-activedescendant` so
   * assistive tech follows the keyboard-highlighted row.
   */
  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);

  /** Closes the suggestion dropdown and clears the keyboard highlight, leaving focus untouched. */
  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }, []);

  /** Commits the draft gloss only when it differs from the committed value. */
  const commitDraft = () => {
    if (draft !== committedGloss) {
      onGlossChange(token.ref, token.surfaceText, draft);
    }
  };

  /**
   * Approves the chosen suggestion payload for this token and closes the dropdown. Any typed draft
   * is discarded: the approval updates `committedGloss`, which the sync effect mirrors back into
   * the input so the selection wins.
   *
   * @param id - The chosen payload's id (the suggested pick or a promoted candidate).
   */
  const selectSuggestion = (id: string) => {
    approveAnalysis(token.ref, token.surfaceText, id);
    closeSuggestions();
  };

  /**
   * Drives the gloss input as a combobox. While the dropdown is open, arrow keys move the highlight
   * (stopping at the ends; Up returns to the no-highlight state), Enter commits the highlighted row
   * or the top row, and Escape closes without committing. While closed, ArrowDown opens the
   * dropdown (the keyboard way to reopen it after typing has closed it, without clearing the field)
   * and Enter commits the typed draft.
   */
  const handleGlossKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestionsOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, glossedRanked.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSuggestions();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // activeIndex -1 (nothing highlighted) falls back to the top row. glossedRanked can empty
        // out after open (a row approved away), leaving suggestionsOpen stale while the dropdown is
        // unmounted — guard so Enter closes rather than dereferencing an absent pick.
        const pick = glossedRanked[activeIndex] ?? glossedRanked[0];
        if (pick) selectSuggestion(pick.id);
        /* v8 ignore next -- defensive: the empty-pick race above is not reachable from the call sites */ else
          closeSuggestions();
      }
    } else if (e.key === 'ArrowDown' && hasSuggestions) {
      e.preventDefault();
      setActiveIndex(-1);
      setSuggestionsOpen(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    }
  };

  /**
   * Handles gloss-input focus: runs the parent's focus side effect (scroll-into-view), marks the
   * input focused so the "+" button can show, and opens the suggestion dropdown whenever the token
   * has suggestions — so clicking the gloss (which focuses it) summons the list on both empty and
   * already-glossed tokens.
   */
  const handleFocus = () => {
    onFocus();
    setInputFocused(true);
    if (hasSuggestions) {
      setActiveIndex(-1);
      setSuggestionsOpen(true);
    }
  };

  /**
   * Handles gloss-input typing: updates the draft, and re-opens the dropdown when the field is
   * emptied back out or closes it as soon as the user types a gloss (which overrides the
   * suggestion).
   */
  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (value === '') {
      if (hasSuggestions) setSuggestionsOpen(true);
    } else {
      closeSuggestions();
    }
  };

  /** Toggles the dropdown from the "+" button, focusing the input so keyboard navigation works. */
  const handleAddClick = () => {
    const willOpen = !suggestionsOpen;
    setActiveIndex(-1);
    setSuggestionsOpen(willOpen);
    // Focus after setting open so the focus handler's auto-open agrees with willOpen (both want
    // open); on close we leave focus where it is.
    if (willOpen) glossInputRef.current?.focus({ preventScroll: true });
  };

  /**
   * Ref callback that stores the gloss input element for focus control from the "+" button.
   *
   * @param el - The mounted input, or `null` on unmount.
   */
  const setGlossInputRef = (el: HTMLInputElement | null) => {
    glossInputRef.current = el ?? undefined;
  };

  // Whether the dropdown is actually mounted: open AND still has rows (a row may have been approved
  // away). When false the input's combobox attributes collapse to the closed state.
  const dropdownShown = suggestionsOpen && hasSuggestions;

  // Whether the "+" button is faded in. Its layout slot (the input's reserved end-padding) is
  // always present, so this governs only opacity/interactivity, never layout.
  const addVisible = inputFocused || chipHovered;

  // The label is bound to the gloss input with an explicit htmlFor so clicking the chip body always
  // focuses the gloss input. Without it, the label's implicit control would be its first labelable
  // descendant — the morpheme trigger button (or a morpheme gloss input) when showMorphology is on —
  // and clicking the chip would activate that instead.
  return (
    <span className="tw:relative tw:inline-flex tw:shrink-0">
      {onRemove && (
        <Button
          aria-label={formatReplacementString(removeLabelTemplate, {
            token: token.surfaceText,
          })}
          className={`tw:absolute tw:-top-1.5 tw:-right-1.5 tw:z-10 tw:flex tw:h-3.5 tw:w-3.5 tw:items-center tw:justify-center tw:rounded-full tw:border tw:bg-background tw:p-0${isRemoveHovered ? ' tw:border-destructive tw:text-destructive' : ' tw:border-border tw:text-muted-foreground'}`}
          tabIndex={-1}
          type="button"
          variant="ghost"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          onMouseEnter={() => setIsRemoveHovered(true)}
          onMouseLeave={() => setIsRemoveHovered(false)}
        >
          <X className="tw:size-2.5" />
        </Button>
      )}
      <label
        className={`tw:inline-flex tw:flex-col tw:items-center tw:rounded tw:border tw:bg-muted tw:px-0.5 tw:py-0.5${isRemoveHovered || isSplitFree ? ' tw:border-destructive' : ' tw:border-border'}${disabled ? ' tw:pointer-events-none' : ''}`}
        onMouseDown={disabled ? undefined : handleLabelMouseDown}
        onMouseEnter={() => setChipHovered(true)}
        onMouseLeave={() => setChipHovered(false)}
        htmlFor={glossInputId}
      >
        <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground tw:cursor-text">
          {token.surfaceText}
        </span>
        {showMorphology && (
          // The morpheme row is the popover anchor; the panel itself is portaled to document.body
          // by PopoverContent, so it escapes both the clipping of ancestor scroll viewports (e.g.
          // the continuous view's token strip) and the `token-row` stacking contexts that would
          // otherwise paint later segment rows over it. Modal, so interactions outside the panel are
          // blocked while open. Mounted only while open so its draft state re-initializes from the
          // current forms on every open.
          //
          // `onOpenChange` is intentionally omitted: this consumer owns every dismissal path
          // (onEscapeKeyDown, onPointerDownOutside, explicit button clicks). Don't wire onOpenChange
          // without also removing those, or closes would double-fire.
          <Popover modal open={popoverOpen}>
            {hasMorphemes ? (
              <MorphemeBox
                analysisLanguage={analysisLanguage}
                disabled={disabled}
                labels={labels}
                morphemes={morphemes}
                onEditBreakdown={openMorphemeEditor}
                onGlossFocus={onFocus}
                popoverOpen={popoverOpen}
                token={token}
              />
            ) : (
              <PopoverAnchor asChild>
                <Button
                  aria-label={formatReplacementString(labels.defineMorphemes, {
                    token: token.surfaceText,
                  })}
                  className={`tw:flex tw:h-auto tw:flex-row tw:items-center tw:rounded tw:px-0.5 tw:py-0 tw:font-mono tw:text-xs tw:italic tw:text-muted-foreground/50 tw:transition-colors${disabled ? '' : ' tw:cursor-pointer tw:hover:bg-accent'}`}
                  tabIndex={-1}
                  type="button"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!disabled) openMorphemeEditor();
                  }}
                >
                  <span className="tw:whitespace-nowrap">{token.surfaceText}</span>
                </Button>
              </PopoverAnchor>
            )}
            {popoverOpen && (
              <MorphemeBreakdownPopover
                glossInputId={glossInputId}
                initialValue={
                  hasMorphemes ? morphemes.map((m) => m.form).join(' ') : token.surfaceText
                }
                needsResetConfirm={resetLosesGlosses}
                onClose={() => setPopoverOpen(false)}
                onReset={hasMorphemes ? () => dispatchMorphemeDelete(token.ref) : undefined}
                onSave={handleMorphemeSave}
                surfaceText={token.surfaceText}
              />
            )}
          </Popover>
        )}
        {/* A second popover root, independent of the morpheme editor's above. Anchoring the panel on
            the gloss field keeps it with that field as the continuous view scrolls the focused token
            into place.

            `onOpenChange` is intentionally omitted: this consumer owns every dismissal path (the
            input's key, typing, and blur handling). Don't wire it without also removing those, or
            closes would double-fire. */}
        <Popover open={dropdownShown}>
          {/* The gloss input acts as the combobox; the "+" button is a trailing in-field decoration
              that summons the dropdown over typed text, shown only for a token with more than one
              suggestion and fading in on focus/hover. The input reserves symmetric end-padding
              (sized to clear the button) on EVERY chip regardless of suggestions or feature state,
              so the gloss text stays centered, the chip never reflows as the button appears, and
              widths stay uniform. The button stays out of the tab order so tabbing hits one stop per
              token. */}
          <PopoverAnchor asChild>
            <span className="tw:relative tw:mt-0.5 tw:inline-flex tw:items-center">
              <input
                ref={setGlossInputRef}
                // Combobox semantics apply only when this token actually has a suggestion popup;
                // without suggestions it stays a plain text input.
                aria-activedescendant={
                  dropdownShown && activeIndex >= 0 ? optionId(activeIndex) : undefined
                }
                aria-autocomplete={hasSuggestions ? 'none' : undefined}
                aria-controls={dropdownShown ? listboxId : undefined}
                aria-expanded={hasSuggestions ? dropdownShown : undefined}
                aria-label={formatReplacementString(labels.tokenGloss, {
                  token: token.surfaceText,
                })}
                // When the empty input shows a suggested gloss as its placeholder, color that ghost
                // text via the same `gloss-suggested` utility the dropdown's accept row uses (one
                // source of truth for the suggested blue) and italicize it at full opacity, so it
                // reads as a suggestion rather than a faint generic hint.
                className={`tw:gloss-input${showSuggestedPlaceholder ? ' tw:placeholder:gloss-suggested tw:placeholder:italic tw:placeholder:opacity-100' : ''}`}
                disabled={disabled}
                id={glossInputId}
                placeholder={
                  showSuggestedPlaceholder
                    ? `${suggestedGloss}${SUGGESTED_PLACEHOLDER_PAD}`
                    : glossPlaceholder
                }
                role={hasSuggestions ? 'combobox' : undefined}
                // Inline padding overrides the `gloss-input` utility's default px to reserve room
                // for the trailing "+" button symmetrically (keeping the gloss text centered)
                // without a spacer element. The top margin is zeroed here and moved to the wrapping
                // span so the span's box matches the input exactly, letting the absolutely-
                // positioned button center on the input rather than on a box inflated at the top by
                // the margin.
                style={{
                  fieldSizing: 'content',
                  marginTop: 0,
                  minWidth: '5ch',
                  paddingLeft: '0.75rem',
                  paddingRight: '0.75rem',
                }}
                value={draft}
                onBlur={
                  disabled
                    ? undefined
                    : () => {
                        setInputFocused(false);
                        closeSuggestions();
                        commitDraft();
                      }
                }
                onChange={(e) => handleDraftChange(e.target.value)}
                onFocus={disabled ? undefined : handleFocus}
                onKeyDown={disabled ? undefined : handleGlossKeyDown}
                onMouseDown={disabled ? undefined : handleMouseDown}
                type="text"
              />
              {hasMultipleSuggestions && (
                <Button
                  aria-controls={dropdownShown ? listboxId : undefined}
                  aria-expanded={dropdownShown}
                  aria-hidden={!addVisible}
                  aria-label={formatReplacementString(labels.showSuggestions, {
                    token: token.surfaceText,
                  })}
                  // Absolutely positioned inside the input's reserved end-padding so it never
                  // affects layout; we toggle only opacity, fading the button in on focus/hover.
                  // When hidden it is also made non-interactive so an invisible button can't swallow
                  // clicks. Vertical centering is by margin rather than a transform, keeping it out
                  // of the property the button transitions and transforms on press.
                  className={`tw:absolute tw:inset-y-0 tw:right-0.5 tw:my-auto tw:flex tw:h-2.5 tw:w-2.5 tw:items-center tw:justify-center tw:rounded tw:p-0 tw:text-muted-foreground tw:cursor-pointer tw:transition-opacity tw:hover:bg-accent${addVisible ? '' : ' tw:pointer-events-none tw:opacity-0'}`}
                  data-testid="suggestion-add"
                  tabIndex={-1}
                  type="button"
                  variant="ghost"
                  onClick={handleAddClick}
                  // Suppress the mouse-down focus shift so clicking the button never blurs the input.
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <Plus className="tw:size-2.5" />
                </Button>
              )}
            </span>
          </PopoverAnchor>
          {dropdownShown && (
            <SuggestionDropdown
              activeIndex={activeIndex}
              entries={glossedRanked}
              listboxId={listboxId}
              optionId={optionId}
              acceptLabelTemplate={labels.acceptSuggestion}
              breakdownLabelTemplate={labels.suggestionBreakdown}
              promoteLabelTemplate={labels.promoteSuggestion}
              tokenSurfaceText={token.surfaceText}
              onActiveIndexChange={setActiveIndex}
              onSelect={selectSuggestion}
            />
          )}
        </Popover>
      </label>
    </span>
  );
}

/** Renders a non-word token (e.g. punctuation) as muted inline monospace text with no gloss input. */
export function InertTokenChip({ token }: Readonly<{ token: Token }>) {
  return (
    <span className="tw:inline-block tw:font-mono tw:text-sm tw:text-muted-foreground tw:pt-0.5">
      {token.surfaceText}
    </span>
  );
}

/** Memoized version of {@link TokenChip}; use in render-stable token lists. */
const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;
