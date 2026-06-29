import type { Token } from 'interlinearizer';
import { useLocalizedStrings } from '@papi/frontend/react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverAnchor } from 'platform-bible-react';
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
import { resolvedOrEmpty } from '../utils/localized-strings';
import { glossedSuggestionEntries } from '../utils/suggestion-engine';
import {
  useAnalysisLanguage,
  useApproveAnalysisDispatch,
  useGloss,
  useGlossDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemes,
  useReportGlossEditing,
  useResolvedTokenAnalysis,
  useShowSuggestions,
} from './AnalysisStore';
import { MorphemeBreakdownPopover, MorphemeGlossInput } from './MorphemeEditor';
import SuggestionDropdown from './SuggestionDropdown';

const STRING_KEYS = [
  '%interlinearizer_tokenChip_editMorphemes%',
  '%interlinearizer_tokenChip_defineMorphemes%',
  '%interlinearizer_glossInput_placeholder%',
] as const satisfies `%${string}%`[];

/**
 * Renders a single word token as an inline chip with an editable gloss input below the surface
 * text. Gloss value and dispatch are read from {@link AnalysisStoreProvider} context via
 * {@link useGloss} and {@link useGlossDispatch}. The gloss is written to the store only on blur, and
 * only when the draft differs from the committed value, to avoid creating empty analysis entries on
 * focus/blur cycles with no edits.
 *
 * When `showMorphology` is true, a morpheme row is shown below the surface text. For unanalyzed
 * tokens this is a clickable button showing the surface text; for analyzed tokens it shows the
 * morpheme forms. Clicking either opens an inline popover where the user can define, edit, or
 * delete the morpheme breakdown. Per-morpheme gloss inputs appear below the morpheme forms.
 *
 * @param props - Component props
 * @param props.token - The word token to render.
 * @param props.onFocus - Called when the gloss input receives focus.
 * @param props.disabled - When true, the gloss input is read-only and non-interactive.
 * @param props.onRemove - When provided, renders a small X button in the top-right corner of the
 *   chip; clicking it calls this callback to remove the token from its phrase.
 * @param props.isSplitFree - When true, this token would become free (solo) if the currently
 *   hovered split/unlink button were clicked; previewed with a destructive border on the chip.
 * @param props.showMorphology - When true, morpheme breakdown and per-morpheme glosses are shown
 *   below the surface text.
 * @returns A styled label containing the surface text, optionally morpheme rows, and a gloss input.
 */
export function TokenChip({
  token,
  onFocus,
  disabled = false,
  onRemove,
  isSplitFree = false,
  showMorphology = false,
}: Readonly<{
  token: Token & { type: 'word' };
  onFocus: () => void;
  disabled?: boolean;
  onRemove?: () => void;
  isSplitFree?: boolean;
  showMorphology?: boolean;
}>) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const committedGloss = useGloss(token.ref);
  const onGlossChange = useGlossDispatch();
  const morphemes = useMorphemes(token.ref);
  const analysisLanguage = useAnalysisLanguage();
  const dispatchMorphemeBreakdown = useMorphemeBreakdownDispatch();
  const dispatchMorphemeDelete = useMorphemeDeleteDispatch();
  const showSuggestions = useShowSuggestions();
  // Only resolve the pool when suggestions are actually shown; off, this does no per-token lookup.
  const resolved = useResolvedTokenAnalysis(token.ref, token.surfaceText, showSuggestions);
  const approveAnalysis = useApproveAnalysisDispatch();
  const [draft, setDraft] = useState(committedGloss);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const glossInputId = useId();
  const glossInputRef = useRef<HTMLInputElement | undefined>(undefined);
  // The suggestion combobox: an `activeIndex` of -1 means no row is highlighted, so a bare Enter
  // commits the top suggestion. The dropdown auto-opens on focus of an empty input and closes once
  // the user types (it is keyed off the token's surface form, not the typed text). The chevron can
  // re-open it over typed text; `inputFocused` / `chipHovered` only gate the chevron's visibility.
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

  // The popover tree unmounts with the morpheme row when showMorphology turns off, but this state
  // lives on the chip and would survive — silently reopening the popover when morphology is shown
  // again. Clearing it on hide also closes the popover. We also close it when the chip becomes
  // disabled: the popover content renders on `popoverOpen` alone (it isn't gated on `disabled`), so
  // a chip whose popover is open while it transitions to disabled would otherwise stay editable.
  useEffect(() => {
    if (!showMorphology || disabled) setPopoverOpen(false);
  }, [showMorphology, disabled]);

  /**
   * Intercepts mouse-down on the gloss input to suppress the browser's built-in focus-and-scroll,
   * then re-focuses the input with `preventScroll` so only the React-controlled smooth
   * scrollIntoView fires.
   *
   * @param e - The gloss input's mouse-down event.
   */
  const handleMouseDown: MouseEventHandler<HTMLInputElement> = (e) => {
    // Prevent the browser's built-in focus-and-scroll so only the React-controlled
    // smooth scrollIntoView fires. We re-focus manually with preventScroll instead.
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
  };

  /**
   * Intercepts mouse-down on the chip's label (the surface text and padding) so the label's native
   * activation — which forwards focus to the gloss input with the browser's default
   * scroll-into-view — can never scroll the list under the click. Focuses the input directly with
   * `preventScroll` instead; the native forwarding then finds it already focused and does nothing.
   * The input is looked up by id rather than `querySelector('input')` because the morpheme gloss
   * inputs precede it inside the label when morphology is shown. A mouse-down on any input is left
   * to that input's own handling ({@link handleMouseDown} for the gloss input, which bubbles here
   * after already handling it); a mouse-down on the morpheme trigger button is left to the button's
   * own click handler, which opens the popover.
   *
   * @param e - The label's mouse-down event.
   */
  const handleLabelMouseDown: MouseEventHandler<HTMLLabelElement> = (e) => {
    if (e.target instanceof Element && e.target.closest('input, button')) return;
    e.preventDefault();
    document.getElementById(glossInputId)?.focus({ preventScroll: true });
  };

  /**
   * Commits the morpheme breakdown from the popover input, splitting on whitespace.
   *
   * @param value - The raw text from the popover input.
   */
  const handleMorphemeSave = (value: string) => {
    const forms = value.split(/\s+/).filter(Boolean);
    if (forms.length > 0) {
      dispatchMorphemeBreakdown(token.ref, token.surfaceText, forms, token.writingSystem);
    }
  };

  const hasMorphemes = morphemes.length > 0;

  // The pool entries to offer via the suggestion dropdown, with their accept/promote status. The
  // engine flattens the resolved read into ranked, status-tagged rows: for a suggested token its
  // pick (green "accept") plus candidates (blue "promote"); for an approved token the pool
  // alternatives only (all blue "promote", the already-approved payload excluded). Blank-in-active-
  // language entries are dropped individually rather than shown as empty rows (see
  // `user-questions.md` display #3). Memoized on the (reference-stable) resolved read and active
  // language so typing a gloss — which only changes local draft state — never re-runs the flatten/
  // filter; it recomputes only when the resolved read or language actually changes.
  const glossedRanked = useMemo(
    () => glossedSuggestionEntries(resolved, analysisLanguage),
    [resolved, analysisLanguage],
  );
  // Whether this token has anything to suggest: gated on the demo toggle (via the resolve short-
  // circuit) and editability. The chevron and dropdown only ever appear when this is true.
  const hasSuggestions = showSuggestions && !disabled && glossedRanked.length > 0;
  // The engine's top pick (row 0, the green "suggested"), shown as ghost placeholder text in the
  // empty input so the row reveals at a glance which tokens already have a suggestion — without
  // needing focus or hover. Only meaningful while the draft is empty; once the user types, the
  // typed value replaces it. Undefined when this token has no suggestion to offer.
  const suggestedGloss = hasSuggestions ? glossedRanked[0].gloss : undefined;
  const showSuggestedPlaceholder = suggestedGloss !== undefined && draft === '';

  /**
   * Builds the listbox option element id for a row, kept in sync with the input's
   * `aria-activedescendant` so assistive tech can follow the keyboard-highlighted row.
   *
   * @param index - The row's index in {@link glossedRanked}.
   * @returns The option element id.
   */
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  /** Closes the suggestion dropdown and clears the keyboard highlight, leaving focus untouched. */
  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }, []);

  /**
   * Commits the current draft gloss the same way blur does: only when it differs from the committed
   * value. Only called from the (disabled-gated) blur and key-down handlers, so it needs no
   * disabled check.
   */
  const commitDraft = () => {
    if (draft !== committedGloss) {
      onGlossChange(token.ref, token.surfaceText, draft);
    }
  };

  /**
   * Approves the chosen suggestion payload for this token and closes the dropdown. The typed draft
   * (if any) is discarded: approving updates committedGloss, which the sync effect mirrors back
   * into the input, so the selection wins over the abandoned draft.
   *
   * @param id - The chosen payload's id (the suggested pick or a promoted candidate).
   */
  const selectSuggestion = (id: string) => {
    approveAnalysis(token.ref, token.surfaceText, id);
    closeSuggestions();
  };

  /**
   * Drives the gloss input as a combobox. While the dropdown is open, arrow keys move the highlight
   * (stopping at the ends, with Up returning to the no-highlight state), Enter commits the
   * highlight or the top row, and Escape closes without committing. While it is closed, ArrowDown
   * opens the dropdown (the keyboard equivalent of the chevron) when this token has suggestions —
   * so an approved token whose dropdown does not auto-open on focus can still summon its pool
   * alternatives from the keyboard — and Enter commits the typed draft. Other keys fall through to
   * the input.
   *
   * @param e - The gloss input's key-down event.
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
        // activeIndex -1 (nothing highlighted) falls back to the top row. The list is normally
        // non-empty while open, but glossedRanked can empty out after open (a row approved away),
        // leaving suggestionsOpen stale while the dropdown is unmounted — guard so Enter closes
        // rather than dereferencing an absent pick.
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
   * input focused so the chevron can show, and auto-opens the dropdown when the input is empty.
   */
  const handleFocus = () => {
    onFocus();
    setInputFocused(true);
    if (draft === '' && hasSuggestions) {
      setActiveIndex(-1);
      setSuggestionsOpen(true);
    }
  };

  /**
   * Handles gloss-input typing: updates the draft, and re-opens the dropdown when the field is
   * emptied back out or closes it as soon as the user types a gloss (which overrides the
   * suggestion).
   *
   * @param value - The new input value.
   */
  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (value === '') {
      if (hasSuggestions) setSuggestionsOpen(true);
    } else {
      closeSuggestions();
    }
  };

  /** Toggles the dropdown from the chevron, focusing the input so keyboard navigation works. */
  const handleChevronClick = () => {
    const willOpen = !suggestionsOpen;
    setActiveIndex(-1);
    setSuggestionsOpen(willOpen);
    // Focus after setting open so the focus handler's empty-input auto-open agrees with willOpen
    // (both want open); on close we leave focus where it is.
    if (willOpen) glossInputRef.current?.focus({ preventScroll: true });
  };

  /**
   * Ref callback that stores the gloss input element for focus control (from the chevron) and as
   * the dropdown's positioning anchor. Normalizes React's `null` on unmount to `undefined` to match
   * the repo's ref-typing convention.
   *
   * @param el - The mounted input, or `null` on unmount.
   */
  const setGlossInputRef = (el: HTMLInputElement | null) => {
    glossInputRef.current = el ?? undefined;
  };

  // Whether the dropdown is actually mounted: open AND still has rows (a row may have been approved
  // away). When false the input's combobox attributes collapse to the closed state.
  const dropdownShown = suggestionsOpen && hasSuggestions;

  // The X button is positioned outside the <label>, and the label is bound to the gloss input with
  // an explicit htmlFor, so clicking the chip body always focuses the gloss input. Without the
  // explicit binding, the label's implicit control would be its first labelable descendant — the X
  // button, or the morpheme trigger button when showMorphology is on — and clicking anywhere on
  // the chip (label-association behavior) would activate that button instead.
  return (
    <span className="tw:relative tw:inline-flex tw:shrink-0">
      {onRemove && (
        <button
          aria-label={`Remove ${token.surfaceText} from phrase`}
          className={`tw:absolute tw:-top-1.5 tw:-right-1.5 tw:z-10 tw:flex tw:h-3.5 tw:w-3.5 tw:items-center tw:justify-center tw:rounded-full tw:border tw:bg-background${isRemoveHovered ? ' tw:border-destructive tw:text-destructive' : ' tw:border-border tw:text-muted-foreground'}`}
          tabIndex={-1}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          onMouseEnter={() => setIsRemoveHovered(true)}
          onMouseLeave={() => setIsRemoveHovered(false)}
        >
          <X className="tw:h-2.5 tw:w-2.5" />
        </button>
      )}
      <label
        className={`tw:inline-flex tw:flex-col tw:items-center tw:rounded tw:border tw:bg-muted tw:px-1.5 tw:py-0.5${isRemoveHovered || isSplitFree ? ' tw:border-destructive' : ' tw:border-border'}${disabled ? ' tw:pointer-events-none' : ''}`}
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
          // otherwise paint later segment rows over it. The popover is modal so interactions
          // outside the panel are blocked while it is open. The popover component is mounted only
          // while open so its draft state re-initializes from the current forms on every open.
          //
          // `onOpenChange` is intentionally omitted: this consumer owns every dismissal path
          // (onEscapeKeyDown, onInteractOutside, explicit button clicks), so Radix's internal close
          // requests aren't needed. Don't wire onOpenChange without also removing those, or closes
          // would double-fire.
          <Popover modal open={popoverOpen}>
            <PopoverAnchor asChild>
              <div className="tw:relative tw:flex tw:flex-col tw:items-center tw:w-full">
                <button
                  aria-label={(hasMorphemes
                    ? localizedStrings['%interlinearizer_tokenChip_editMorphemes%']
                    : localizedStrings['%interlinearizer_tokenChip_defineMorphemes%']
                  ).replace('{token}', token.surfaceText)}
                  className={`tw:flex tw:flex-row tw:gap-0.5 tw:items-center tw:rounded tw:px-0.5 tw:transition-colors${disabled ? '' : ' tw:cursor-pointer tw:hover:bg-accent'} ${hasMorphemes ? 'tw:text-muted-foreground' : 'tw:text-muted-foreground/50 tw:italic'}`}
                  tabIndex={-1}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!disabled) setPopoverOpen(true);
                  }}
                >
                  {hasMorphemes ? (
                    morphemes.map((m) => (
                      <span key={m.id} className="tw:whitespace-nowrap tw:font-mono tw:text-xs">
                        {m.form}
                      </span>
                    ))
                  ) : (
                    <span className="tw:whitespace-nowrap tw:font-mono tw:text-xs">
                      {token.surfaceText}
                    </span>
                  )}
                </button>
                {hasMorphemes && (
                  <span className="tw:flex tw:flex-row tw:gap-0.5">
                    {morphemes.map((m) => (
                      <MorphemeGlossInput
                        key={m.id}
                        analysisLanguage={analysisLanguage}
                        disabled={disabled}
                        morpheme={m}
                        tokenRef={token.ref}
                      />
                    ))}
                  </span>
                )}
              </div>
            </PopoverAnchor>
            {popoverOpen && (
              <MorphemeBreakdownPopover
                glossInputId={glossInputId}
                initialValue={
                  hasMorphemes ? morphemes.map((m) => m.form).join(' ') : token.surfaceText
                }
                onClose={() => setPopoverOpen(false)}
                onDelete={hasMorphemes ? () => dispatchMorphemeDelete(token.ref) : undefined}
                onSave={handleMorphemeSave}
                surfaceText={token.surfaceText}
              />
            )}
          </Popover>
        )}
        {/* The gloss input acts as the combobox; the chevron (shown only when this chip has
            suggestions and is focused or hovered) is a mouse affordance to summon the dropdown,
            including over already-typed text. The chevron stays out of the tab order so tabbing
            across the interlinear row hits one stop per token — the input. */}
        <span className="tw:flex tw:flex-row tw:items-center tw:gap-0.5">
          <input
            ref={setGlossInputRef}
            // Combobox semantics apply only when this token actually has a suggestion popup; without
            // suggestions it stays a plain text input.
            aria-activedescendant={
              dropdownShown && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-autocomplete={hasSuggestions ? 'none' : undefined}
            aria-controls={dropdownShown ? listboxId : undefined}
            aria-expanded={hasSuggestions ? dropdownShown : undefined}
            aria-label={`Gloss for ${token.surfaceText}`}
            // When the empty input is showing a suggested gloss as its placeholder, color that ghost
            // text via the same `gloss-suggested` utility the dropdown's accept row uses (one source
            // of truth for the suggested green) and italicize it, at full opacity, so it reads
            // clearly as a suggestion rather than a faint generic hint.
            className={`tw:gloss-input${showSuggestedPlaceholder ? ' tw:placeholder:gloss-suggested tw:placeholder:italic tw:placeholder:opacity-100' : ''}`}
            disabled={disabled}
            id={glossInputId}
            placeholder={
              showSuggestedPlaceholder
                ? suggestedGloss
                : resolvedOrEmpty(localizedStrings['%interlinearizer_glossInput_placeholder%'])
            }
            role={hasSuggestions ? 'combobox' : undefined}
            style={{ fieldSizing: 'content', minWidth: '5ch' }}
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
          {hasSuggestions && (inputFocused || chipHovered) && (
            <button
              aria-controls={dropdownShown ? listboxId : undefined}
              aria-expanded={dropdownShown}
              aria-label={`Show suggestions for ${token.surfaceText}`}
              className="tw:flex tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded tw:text-muted-foreground tw:cursor-pointer tw:hover:bg-accent"
              data-testid="suggestion-chevron"
              tabIndex={-1}
              type="button"
              onClick={handleChevronClick}
              // Suppress the mouse-down focus shift so clicking the chevron never blurs the input.
              onMouseDown={(e) => e.preventDefault()}
            >
              <ChevronDown className={`tw:h-3 tw:w-3${dropdownShown ? ' tw:rotate-180' : ''}`} />
            </button>
          )}
        </span>
        {dropdownShown && (
          <SuggestionDropdown
            activeIndex={activeIndex}
            anchorRef={glossInputRef}
            entries={glossedRanked}
            listboxId={listboxId}
            optionId={optionId}
            surfaceText={token.surfaceText}
            onActiveIndexChange={setActiveIndex}
            onRequestClose={closeSuggestions}
            onSelect={selectSuggestion}
          />
        )}
      </label>
    </span>
  );
}

/**
 * Renders a non-word token (e.g. punctuation) as muted inline monospace text with no gloss input.
 *
 * @param props - Component props
 * @param props.token - The non-word token to render.
 * @returns A muted inline span.
 */
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
