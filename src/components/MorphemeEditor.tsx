/**
 * @file Inline morpheme editing components rendered inside {@link TokenChip} when the morphology
 *   toggle is active. {@link MorphemeBreakdownPopover} lets the user define or re-split a token's
 *   morpheme forms; {@link MorphemeGlossInput} provides a per-morpheme gloss field.
 */
import type { MorphemeAnalysis } from 'interlinearizer';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useMorphemeGlossDispatch } from './AnalysisStore';

/**
 * Inline popover for defining or editing a token's morpheme breakdown. The user types
 * space-separated morpheme forms (e.g. "un- believe -able") and commits with Enter or Done.
 *
 * @param props - Component props.
 * @param props.initialValue - Pre-filled text for the input (current morpheme forms joined by
 *   spaces, or the full surface text when no breakdown exists yet).
 * @param props.onSave - Called with the raw input string when the user commits.
 * @param props.onClose - Called to dismiss the popover without saving.
 * @returns A positioned popover panel with a text input and Done button.
 */
export function MorphemeBreakdownPopover({
  initialValue,
  onSave,
  onClose,
}: Readonly<{
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
}>) {
  const [draft, setDraft] = useState(initialValue);
  // eslint-disable-next-line no-null/no-null
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  /** Commits the current draft and closes the popover. */
  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    onClose();
  };

  /**
   * Handles Enter to commit and Escape to dismiss.
   *
   * @param e - The keyboard event.
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  /**
   * Prevents the click from bubbling to the backdrop dismiss handler.
   *
   * @param e - The mouse event on the popover panel.
   */
  const stopPropagation = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="tw:fixed tw:inset-0 tw:z-20" onClick={onClose} />
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="tw:absolute tw:left-0 tw:z-30 tw:mt-1 tw:min-w-48 tw:rounded-md tw:border tw:border-border tw:bg-popover tw:p-2 tw:shadow-md tw:flex tw:flex-col tw:gap-1.5"
        onClick={stopPropagation}
      >
        <label className="tw:text-xs tw:text-muted-foreground" htmlFor="morpheme-input">
          Split into morphemes
        </label>
        <input
          ref={inputRef}
          className="tw:w-full tw:rounded tw:border tw:border-input tw:bg-background tw:px-2 tw:py-1 tw:text-sm tw:font-mono"
          id="morpheme-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          type="text"
        />
        <button
          className="tw:self-end tw:rounded tw:bg-primary tw:px-3 tw:py-0.5 tw:text-xs tw:text-primary-foreground tw:hover:bg-primary/90"
          type="button"
          onClick={handleSave}
        >
          Done
        </button>
      </div>
    </>
  );
}

/**
 * Renders a single morpheme's gloss as an inline editable input. Writes to the store on blur when
 * the draft differs from the committed value.
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
