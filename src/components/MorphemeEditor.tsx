/**
 * @file Inline morpheme editing components rendered inside {@link TokenChip} when the morphology
 *   toggle is active. {@link MorphemeBreakdownPopover} lets the user define or re-split a token's
 *   morpheme forms; {@link MorphemeGlossInput} provides a per-morpheme gloss field.
 */
import type { MorphemeAnalysis } from 'interlinearizer';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMorphemeGlossDispatch } from './AnalysisStore';

/** Minimum gap in pixels between the popover panel and its anchor or the viewport edges. */
const POPOVER_MARGIN_PX = 4;

/**
 * Inline popover for defining or editing a token's morpheme breakdown. The user types
 * space-separated morpheme forms (e.g. "un- believe -able") and commits with Enter, Done, or by
 * clicking outside the popover (matching the commit-on-blur behavior of gloss inputs). Cancel and
 * Escape dismiss without saving. An unedited draft is never re-saved over an existing breakdown —
 * Enter, Done, and outside clicks all dismiss instead, because re-saving identical forms would only
 * regenerate every morpheme id (which `MorphemeLink.morphemeId` cross-references). When no
 * breakdown exists yet, Enter and Done with the unedited pre-filled surface text deliberately
 * record the token as a single whole-word morpheme, but an outside click dismisses without saving
 * so an accidental click cannot create one.
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
 * @returns A positioned popover panel with a text input and Cancel/Done buttons. The panel and
 *   backdrop are portaled to document.body with `position: fixed`, so they escape both the clipping
 *   of ancestor scroll viewports (e.g. the continuous view's token strip) and the `token-row`
 *   stacking contexts that would otherwise paint later segment rows over the panel. The panel opens
 *   below its anchor and flips above when there is not enough room under the viewport bottom.
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
  // eslint-disable-next-line no-null/no-null
  const panelRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line no-null/no-null
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Position the fixed panel from its anchor (the parent of the in-place marker span — the
  // morpheme row in the token chip). The panel itself is portaled to document.body with fixed
  // positioning because the token chip lives inside scroll viewports that clip vertical overflow
  // and inside `token-row` stacking contexts (z-7) that later segment rows would paint over. The
  // panel opens below the anchor and flips above when the viewport bottom is too close.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current?.parentElement;
    /* v8 ignore next -- the panel and the anchor's parent always exist when the effect runs */
    if (!panel || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    let top = anchorRect.bottom + POPOVER_MARGIN_PX;
    if (top + panelRect.height > window.innerHeight - POPOVER_MARGIN_PX) {
      top = Math.max(POPOVER_MARGIN_PX, anchorRect.top - panelRect.height - POPOVER_MARGIN_PX);
    }
    const left = Math.max(
      POPOVER_MARGIN_PX,
      Math.min(anchorRect.left, window.innerWidth - panelRect.width - POPOVER_MARGIN_PX),
    );
    setPosition({ top, left });
  }, []);

  /**
   * Commits the current draft and closes the popover. Skips the save when the token already has a
   * breakdown (`onDelete` provided) and the text was not edited — re-saving identical forms would
   * only regenerate every morpheme id, which `MorphemeLink.morphemeId` cross-references. An
   * unedited commit on a token with _no_ breakdown is kept: it deliberately records the token as a
   * single whole-word morpheme.
   */
  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && !(onDelete && trimmed === initialValue.trim())) onSave(trimmed);
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
   * Stops the click from reaching ancestor click handlers and cancels the click's default action.
   * The panel is portaled to document.body, so the browser's native label activation cannot fire,
   * but React synthetic events still bubble through the React tree (portal boundary included) to
   * the token chip and its phrase-selection handlers.
   *
   * @param e - The mouse event on the popover panel.
   */
  const handlePanelClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  /**
   * Commits the draft when the user clicks outside the popover, except when the text was not edited
   * — then the click acts like Cancel. Unlike Enter and Done, the unedited check here applies even
   * when the token has no breakdown yet ({@link handleSave} would otherwise create a single-morpheme
   * breakdown equal to the pre-filled surface text), because an accidental outside click is not a
   * deliberate commit. `preventDefault` cancels any default action of whatever sits under the
   * backdrop (see {@link handlePanelClick}).
   *
   * @param e - The mouse event on the full-screen backdrop.
   */
  const handleBackdropClick = (e: MouseEvent) => {
    e.preventDefault();
    if (draft.trim() === initialValue.trim()) {
      onClose();
      return;
    }
    handleSave();
  };

  return (
    <>
      {/* Invisible in-place marker; its parent is the anchor the fixed panel is positioned from. */}
      <span ref={anchorRef} aria-hidden className="tw:hidden" />
      {createPortal(
        <>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="tw:fixed tw:inset-0 tw:z-20" onClick={handleBackdropClick} />
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            ref={panelRef}
            className="tw:fixed tw:z-30 tw:min-w-48 tw:rounded-md tw:border tw:border-border tw:bg-popover tw:p-2 tw:shadow-md tw:flex tw:flex-col tw:gap-1.5"
            style={position ?? { visibility: 'hidden' }}
            onClick={handlePanelClick}
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
          </div>
        </>,
        document.body,
      )}
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
