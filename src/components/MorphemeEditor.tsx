/**
 * @file Inline morpheme editing components rendered inside {@link TokenChip} when the morphology
 *   toggle is active. {@link MorphemeBreakdownPopover} lets the user define or re-split a token's
 *   morpheme forms; {@link MorphemeGlossInput} provides a per-morpheme gloss field.
 */
import type { MorphemeAnalysis } from 'interlinearizer';
import { PopoverContent } from 'platform-bible-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useMorphemeGlossDispatch } from './AnalysisStore';

/**
 * Inline popover for defining or editing a token's morpheme breakdown. The user types
 * space-separated morpheme forms (e.g. "un- believe -able") and commits with Enter, Done, or by
 * clicking outside the popover (matching the commit-on-blur behavior of gloss inputs). Cancel and
 * Escape dismiss without saving. An unedited draft is never re-saved over an existing breakdown —
 * Enter, Done, and outside clicks all dismiss instead, because re-saving identical forms would only
 * rewrite identical data. When no breakdown exists yet, Enter and Done with the unedited pre-filled
 * surface text deliberately record the token as a single whole-word morpheme, but an outside click
 * dismisses without saving so an accidental click cannot create one.
 *
 * Renders the content of a `platform-bible-react` `Popover`; the caller owns the `Popover` root and
 * the `PopoverAnchor` the panel is positioned from, and must render this component only while the
 * popover is open so the draft state re-initializes from `initialValue` on every open. The popover
 * is modal, so interactions outside the panel are blocked while it is open.
 *
 * @param props - Component props.
 * @param props.initialValue - Pre-filled text for the input (current morpheme forms joined by
 *   spaces, or the full surface text when no breakdown exists yet).
 * @param props.onSave - Called with the raw input string when the user commits.
 * @param props.onClose - Called to dismiss the popover.
 * @param props.onDelete - When provided, a Delete button is shown that calls this to remove the
 *   token's existing morpheme breakdown, then dismisses the popover. Callers should omit it when
 *   the token has no breakdown to delete; its presence is also how the popover knows a breakdown
 *   already exists when deciding whether an unedited commit should save.
 * @returns A popover panel with a text input and Cancel/Done buttons.
 */
export function MorphemeBreakdownPopover({
  initialValue,
  onSave,
  onClose,
  onDelete,
}: Readonly<{
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
  onDelete?: () => void;
}>) {
  const inputId = useId();
  const [draft, setDraft] = useState(initialValue);
  // eslint-disable-next-line no-null/no-null
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus and select the input on open. The popover's own auto-focus is suppressed (see
  // onOpenAutoFocus below) so this effect, which runs after it, is the only focus on open.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Whether the draft matches the pre-filled value. Shared by the Done/Enter and outside-click
  // commit paths so the two can never disagree about what counts as an edit. Internal whitespace is
  // collapsed because the save path splits on /\s+/, so differing spacing yields identical forms —
  // comparing normalized text avoids a no-op persistence round-trip.
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');
  const isUnedited = normalize(draft) === normalize(initialValue);

  /**
   * Commits the current draft and closes the popover. Skips the save when the token already has a
   * breakdown (`onDelete` provided) and the text was not edited — re-saving identical forms would
   * only rewrite identical data. An unedited commit on a token with _no_ breakdown is kept: it
   * deliberately records the token as a single whole-word morpheme.
   */
  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && !(onDelete && isUnedited)) onSave(trimmed);
    onClose();
  };

  /**
   * Handles Enter to commit. Escape is handled by the popover itself (`onEscapeKeyDown`).
   *
   * @param e - The keyboard event.
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  /**
   * Commits the draft when the user interacts outside the popover, except when the text was not
   * edited — then the interaction acts like Cancel. Unlike Enter and Done, the unedited check here
   * applies even when the token has no breakdown yet ({@link handleSave} would otherwise create a
   * single-morpheme breakdown equal to the pre-filled surface text), because an accidental outside
   * click is not a deliberate commit.
   */
  const handleInteractOutside = () => {
    if (isUnedited) {
      onClose();
      return;
    }
    handleSave();
  };

  /**
   * Stops mouse events inside the panel from reaching ancestor handlers. The panel is portaled to
   * document.body, but React synthetic events still bubble through the React tree (portal boundary
   * included) to the token chip's label mouse-down handler and its phrase-selection click handlers
   * — which would steal focus to the gloss input behind the popover. The events' default actions
   * are left alone so interactions inside the panel (e.g. the panel's own label focusing its input)
   * keep their native behavior.
   *
   * @param e - The mouse event on the popover panel.
   */
  const stopMouseEvents = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <PopoverContent
      align="start"
      className="tw:flex tw:w-auto tw:min-w-48 tw:flex-col tw:gap-1.5 tw:p-2"
      onClick={stopMouseEvents}
      onMouseDown={stopMouseEvents}
      onEscapeKeyDown={onClose}
      onInteractOutside={handleInteractOutside}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <label className="tw:text-xs tw:text-muted-foreground" htmlFor={inputId}>
        Split into morphemes
      </label>
      <input
        ref={inputRef}
        className="tw:w-full tw:rounded tw:border tw:border-input tw:bg-background tw:px-2 tw:py-1 tw:text-sm tw:font-mono"
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        type="text"
      />
      <div className="tw:flex tw:justify-end tw:gap-1.5">
        {onDelete && (
          <button
            className="tw:me-auto tw:rounded tw:border tw:border-destructive tw:px-3 tw:py-0.5 tw:text-xs tw:text-destructive tw:hover:bg-destructive/10"
            type="button"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Delete
          </button>
        )}
        <button
          className="tw:rounded tw:border tw:border-border tw:px-3 tw:py-0.5 tw:text-xs tw:text-muted-foreground tw:hover:bg-accent"
          type="button"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="tw:rounded tw:bg-primary tw:px-3 tw:py-0.5 tw:text-xs tw:text-primary-foreground tw:hover:bg-primary/90"
          type="button"
          onClick={handleSave}
        >
          Done
        </button>
      </div>
    </PopoverContent>
  );
}

/**
 * Renders a single morpheme's gloss as an inline editable input. Writes to the store on blur when
 * the draft differs from the committed value. The input carries a `data-morpheme-gloss` attribute
 * so container-level "focus the first gloss input" handlers (e.g. {@link PhraseBox}) can exclude
 * morpheme glosses, which precede the token gloss input in DOM order.
 *
 * @param props - Component props.
 * @param props.morpheme - The morpheme whose gloss is being edited.
 * @param props.tokenRef - The token ref for dispatching gloss writes.
 * @param props.analysisLanguage - BCP 47 tag for reading/writing the gloss.
 * @param props.disabled - When true, the input is read-only.
 * @returns A sized text input for the morpheme gloss.
 */
export function MorphemeGlossInput({
  morpheme,
  tokenRef,
  analysisLanguage,
  disabled,
}: Readonly<{
  morpheme: MorphemeAnalysis;
  tokenRef: string;
  analysisLanguage: string;
  disabled: boolean;
}>) {
  const committed = morpheme.gloss?.[analysisLanguage] ?? '';
  const dispatchMorphemeGloss = useMorphemeGlossDispatch();
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return (
    <input
      aria-label={`Gloss for morpheme ${morpheme.form}`}
      className="tw:gloss-input tw:text-xs"
      data-morpheme-gloss="true"
      disabled={disabled}
      placeholder="—"
      style={{ fieldSizing: 'content', minWidth: '2ch' }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!disabled && draft !== committed) dispatchMorphemeGloss(tokenRef, morpheme.id, draft);
      }}
      type="text"
    />
  );
}
