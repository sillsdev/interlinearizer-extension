/**
 * @file Inline morpheme editing components rendered inside {@link TokenChip} when the morphology
 *   toggle is active. {@link MorphemeBreakdownPopover} lets the user define or re-split a token's
 *   morpheme forms; {@link MorphemeGlossInput} provides a per-morpheme gloss field.
 */
import type { MorphemeAnalysis } from 'interlinearizer';
import { useLocalizedStrings } from '@papi/frontend/react';
import { PopoverContent } from 'platform-bible-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useMorphemeGlossDispatch, useReportGlossEditing } from './AnalysisStore';

const POPOVER_STRING_KEYS = [
  '%interlinearizer_morphemeEditor_splitLabel%',
  '%interlinearizer_morphemeEditor_delete%',
  '%interlinearizer_morphemeEditor_cancel%',
  '%interlinearizer_morphemeEditor_done%',
] as const satisfies `%${string}%`[];

const MORPHEME_GLOSS_STRING_KEYS = [
  '%interlinearizer_morphemeGloss_label%',
] as const satisfies `%${string}%`[];

/**
 * Inline popover for defining or editing a token's morpheme breakdown. The user types
 * space-separated morpheme forms (e.g. "un- believe -able") and commits with Enter, Done, or by
 * clicking outside the popover (matching the commit-on-blur behavior of gloss inputs). Cancel and
 * Escape dismiss without saving. An unedited draft is never re-saved over an existing breakdown —
 * Enter, Done, and outside clicks all dismiss instead, because re-saving identical forms would only
 * rewrite identical data. A breakdown that is empty or just the whole word as a single morpheme
 * carries no real segmentation, so it is never saved either: the Done button is disabled for it and
 * the Enter / outside-click paths dismiss without writing.
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
 * @param props.surfaceText - The token's surface text, used to reject a "breakdown" that is just
 *   the whole word as a single morpheme (no real segmentation).
 * @param props.glossInputId - Id of the token's gloss input; used to locate the chip on close so
 *   focus lands on its first morpheme gloss field (falling back to the gloss input itself), rather
 *   than on the non-tabbable morpheme trigger.
 * @returns A popover panel with a text input and Cancel/Done buttons.
 */
export function MorphemeBreakdownPopover({
  initialValue,
  onSave,
  onClose,
  onDelete,
  surfaceText,
  glossInputId,
}: Readonly<{
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
  onDelete?: () => void;
  surfaceText: string;
  glossInputId: string;
}>) {
  const [localizedStrings] = useLocalizedStrings(POPOVER_STRING_KEYS);
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

  /**
   * Collapses leading/trailing and repeated internal whitespace to a single space.
   *
   * @param s - The string to normalize.
   * @returns The string with surrounding whitespace trimmed and internal runs collapsed.
   */
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

  // Whether the draft matches the pre-filled value. Shared by the Done/Enter and outside-click
  // commit paths so the two can never disagree about what counts as an edit. Whitespace is
  // normalized because the save path splits on /\s+/, so differing spacing yields identical forms —
  // comparing normalized text avoids a no-op persistence round-trip.
  const isUnedited = normalize(draft) === normalize(initialValue);

  // A breakdown carries no real segmentation when it is empty or is just the whole word as a single
  // morpheme equal to the surface text; in both cases there is nothing worth persisting.
  const normalized = normalize(draft);
  const forms = normalized === '' ? [] : normalized.split(' ');
  const isMeaningless =
    forms.length === 0 || (forms.length === 1 && forms[0] === normalize(surfaceText));

  /**
   * Commits the current draft and closes the popover. Skips the save when the breakdown is
   * meaningless (empty, or the whole word as one morpheme), or when the token already has a
   * breakdown (`onDelete` provided) and the text was not edited — re-saving identical forms would
   * only rewrite identical data.
   */
  const handleSave = () => {
    if (isMeaningless || (onDelete && isUnedited)) {
      onClose();
      return;
    }
    onSave(draft.trim());
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
   * edited — then the interaction acts like Cancel, because an accidental outside click is not a
   * deliberate commit. An edited-but-meaningless draft is also dismissed without saving by
   * {@link handleSave}.
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

  /**
   * Overrides Radix's default close-focus behavior to land focus on the chip's first morpheme gloss
   * field. The morpheme gloss inputs sit before the token gloss input inside the same label, so the
   * lookup is scoped to that label — the panel is portaled to `document.body`, so a document-wide
   * query could match another token's field. Falls back to the token gloss input when no morpheme
   * field exists (dismissed with no breakdown, or deleted).
   *
   * @param e - The Radix close auto-focus event.
   */
  const handleCloseAutoFocus = (e: Event) => {
    e.preventDefault();
    const glossInput = document.getElementById(glossInputId);
    const firstMorphemeGloss = glossInput
      ?.closest('label')
      ?.querySelector<HTMLInputElement>('input[data-morpheme-gloss]');
    // `preventScroll` keeps the React-controlled scroll the sole scroller.
    (firstMorphemeGloss ?? glossInput)?.focus({ preventScroll: true });
  };

  return (
    <PopoverContent
      align="start"
      className="tw:flex tw:w-auto tw:min-w-48 tw:flex-col tw:gap-1.5 tw:p-2"
      onClick={stopMouseEvents}
      onCloseAutoFocus={handleCloseAutoFocus}
      onEscapeKeyDown={onClose}
      onInteractOutside={handleInteractOutside}
      onMouseDown={stopMouseEvents}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <label className="tw:text-xs tw:text-muted-foreground" htmlFor={inputId}>
        {localizedStrings['%interlinearizer_morphemeEditor_splitLabel%']}
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
            {localizedStrings['%interlinearizer_morphemeEditor_delete%']}
          </button>
        )}
        <button
          className="tw:rounded tw:border tw:border-border tw:px-3 tw:py-0.5 tw:text-xs tw:text-muted-foreground tw:hover:bg-accent"
          type="button"
          onClick={onClose}
        >
          {localizedStrings['%interlinearizer_morphemeEditor_cancel%']}
        </button>
        <button
          className="tw:rounded tw:bg-primary tw:px-3 tw:py-0.5 tw:text-xs tw:text-primary-foreground tw:hover:bg-primary/90 tw:disabled:opacity-50 tw:disabled:pointer-events-none"
          disabled={isMeaningless}
          type="button"
          onClick={handleSave}
        >
          {localizedStrings['%interlinearizer_morphemeEditor_done%']}
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
  const [localizedStrings] = useLocalizedStrings(MORPHEME_GLOSS_STRING_KEYS);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Surface uncommitted typing to the unsaved indicator before the gloss commits on blur.
  useReportGlossEditing(!disabled && draft !== committed);

  return (
    <input
      aria-label={localizedStrings['%interlinearizer_morphemeGloss_label%'].replace(
        '{form}',
        () => morpheme.form,
      )}
      className="tw:gloss-input tw:text-xs"
      data-morpheme-gloss="true"
      disabled={disabled}
      placeholder="—"
      style={{ fieldSizing: 'content', minWidth: '2ch' }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!disabled && draft !== committed) {
          const held = dispatchMorphemeGloss(tokenRef, morpheme.id, draft);
          // Parked in the global-edit modal: revert to the committed gloss so a canceled modal
          // doesn't strand the abandoned draft (and re-prompt on the next blur). An applied
          // "update all" / "fork" choice updates `committed`, which the sync effect mirrors back.
          if (held) setDraft(committed);
        }
      }}
      type="text"
    />
  );
}
