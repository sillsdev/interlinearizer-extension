import type { Token } from 'interlinearizer';
import { X } from 'lucide-react';
import { memo, type MouseEventHandler, useEffect, useId, useRef, useState } from 'react';
import {
  useAnalysisLanguage,
  useGloss,
  useGlossDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemes,
} from './AnalysisStore';
import { MorphemeBreakdownPopover, MorphemeGlossInput } from './MorphemeEditor';

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
  const committedGloss = useGloss(token.ref);
  const onGlossChange = useGlossDispatch();
  const morphemes = useMorphemes(token.ref);
  const analysisLanguage = useAnalysisLanguage();
  const dispatchMorphemeBreakdown = useMorphemeBreakdownDispatch();
  const dispatchMorphemeDelete = useMorphemeDeleteDispatch();
  const [draft, setDraft] = useState(committedGloss);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const glossInputId = useId();
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
   * A mouse-down on the input itself is left to {@link handleMouseDown}, which bubbles here after
   * already handling it.
   *
   * @param e - The label's mouse-down event.
   */
  const handleLabelMouseDown: MouseEventHandler<HTMLLabelElement> = (e) => {
    if (e.target instanceof Element && e.target.closest('input')) return;
    e.preventDefault();
    e.currentTarget.querySelector('input')?.focus({ preventScroll: true });
  };

  /**
   * Commits the morpheme breakdown from the popover input, splitting on whitespace.
   *
   * @param value - The raw text from the popover input.
   */
  const handleMorphemeSave = (value: string) => {
    const forms = value.split(/\s+/).filter(Boolean);
    if (forms.length > 0) {
      dispatchMorphemeBreakdown(token.ref, token.surfaceText, forms);
    }
  };

  const hasMorphemes = morphemes.length > 0;

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
        htmlFor={glossInputId}
      >
        <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground tw:cursor-text">
          {token.surfaceText}
        </span>
        {showMorphology && (
          <div className="tw:relative tw:flex tw:flex-col tw:items-center tw:w-full">
            <button
              aria-label={
                hasMorphemes
                  ? `Edit morpheme breakdown for ${token.surfaceText}`
                  : `Define morpheme breakdown for ${token.surfaceText}`
              }
              className={`tw:flex tw:flex-row tw:gap-0.5 tw:items-center tw:rounded tw:px-0.5 tw:cursor-pointer tw:transition-colors tw:hover:bg-accent ${hasMorphemes ? 'tw:text-muted-foreground' : 'tw:text-muted-foreground/50 tw:italic'}`}
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
            {popoverOpen && (
              <MorphemeBreakdownPopover
                initialValue={
                  hasMorphemes ? morphemes.map((m) => m.form).join(' ') : token.surfaceText
                }
                onClose={() => setPopoverOpen(false)}
                onDelete={hasMorphemes ? () => dispatchMorphemeDelete(token.ref) : undefined}
                onSave={handleMorphemeSave}
              />
            )}
          </div>
        )}
        <input
          aria-label={`Gloss for ${token.surfaceText}`}
          className="tw:gloss-input"
          disabled={disabled}
          id={glossInputId}
          placeholder="gloss"
          style={{ fieldSizing: 'content', minWidth: '5ch' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (!disabled && draft !== committedGloss)
              onGlossChange(token.ref, token.surfaceText, draft);
          }}
          onFocus={disabled ? undefined : onFocus}
          onMouseDown={disabled ? undefined : handleMouseDown}
          type="text"
        />
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
