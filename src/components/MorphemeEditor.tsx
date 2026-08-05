import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, PopoverContent } from 'platform-bible-react';
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

const POPOVER_STRING_KEYS = [
  '%interlinearizer_morphemeEditor_splitLabel%',
  '%interlinearizer_morphemeEditor_reset%',
  '%interlinearizer_morphemeEditor_cancel%',
  '%interlinearizer_morphemeEditor_done%',
  '%interlinearizer_morphemeEditor_emptyHint%',
  '%interlinearizer_morphemeEditor_confirmResetPrompt%',
  '%interlinearizer_morphemeEditor_confirmResetAction%',
] as const satisfies `%${string}%`[];

/**
 * Inline popover for defining or re-splitting a token's morpheme breakdown. This is the _editor_
 * only; the inline display of a breakdown lives separately.
 *
 * The user types space-separated morpheme forms (e.g. "un- believe -able") and commits with Enter,
 * Done, or by clicking outside the popover (matching the commit-on-blur behavior of gloss inputs).
 * Cancel and Escape dismiss without saving.
 *
 * Committing resolves to one of three outcomes:
 *
 * - **Empty** — nothing to interpret, so Done is disabled (with a hint explaining the expected
 *   format) and the Enter / outside-click paths do nothing.
 * - **Unchanged over an existing breakdown** — the commit dismisses rather than rewriting identical
 *   data. Done stays enabled: it means "I'm finished here", and a primary button that is dead on
 *   every open would be unwelcoming, since the panel always opens pre-filled. With no breakdown yet
 *   (`onReset` absent) an unedited draft still saves, because a pre-filled segmentation the user
 *   accepts as-is is new information rather than a rewrite.
 * - **Just the whole word again** — asking for a single morpheme equal to the surface text _is_ a
 *   request for the unsegmented state, so it resets the breakdown rather than saving a segmentation
 *   that carries no information. Only reachable as a real action when a breakdown exists; without
 *   one the pre-fill already is the surface text, so this coincides with unchanged.
 *
 * A single morpheme that _differs_ from the surface text is a legitimate analysis (normalizing an
 * inflected surface to its underlying form) and saves normally — morphemes carry no offsets and are
 * not required to reconstruct the surface text.
 *
 * Both routes to a reset — the reset button and typing the bare surface form — behave identically:
 * the panel swaps into a confirmation when `needsResetConfirm` says the reset would destroy glosses
 * this token solely owns. The confirmation replaces the panel's own content rather than opening a
 * second surface: the panel is portaled to `document.body`, so it floats over the token chip and
 * cannot reflow it, and nesting a modal inside this already-modal popover would stack two focus
 * traps.
 *
 * Renders the content of a `platform-bible-react` `Popover`; the caller owns the `Popover` root and
 * the `PopoverAnchor` the panel is positioned from, and must render this component only while the
 * popover is open so the draft state re-initializes from `initialValue` on every open. The popover
 * is modal, so interactions outside the panel are blocked while it is open.
 */
export function MorphemeBreakdownPopover({
  initialValue,
  onSave,
  onClose,
  onReset,
  needsResetConfirm = false,
  surfaceText,
  glossInputId,
}: Readonly<{
  /**
   * Pre-filled text for the input (current morpheme forms joined by spaces, or the full surface
   * text when no breakdown exists yet).
   */
  initialValue: string;
  /** Called with the raw input string when the user commits. */
  onSave: (value: string) => void;
  /** Called to dismiss the popover. */
  onClose: () => void;
  /**
   * When provided, a Reset button is shown that calls this to remove the token's existing morpheme
   * breakdown, then dismisses the popover. Callers should omit it when the token has no breakdown
   * to reset; its presence is also how the popover knows a breakdown already exists when deciding
   * whether a commit should save, dismiss, or reset.
   */
  onReset?: () => void;
  /**
   * Whether a reset would irreversibly discard morpheme glosses no other token still holds, in
   * which case both reset routes confirm first. Ignored when `onReset` is absent, since there is
   * then no breakdown to lose.
   */
  needsResetConfirm?: boolean;
  /**
   * The token's surface text, used to recognize a "breakdown" that is just the whole word as a
   * single morpheme (a request to reset).
   */
  surfaceText: string;
  /**
   * Id of the token's gloss input; used to locate the chip on close so focus lands on its first
   * morpheme gloss field (falling back to the gloss input itself), rather than on the non-tabbable
   * morpheme trigger.
   */
  glossInputId: string;
}>) {
  const [localizedStrings] = useLocalizedStrings(POPOVER_STRING_KEYS);
  const inputId = useId();
  const [draft, setDraft] = useState(initialValue);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Whether the panel is closing because the user pressed the pointer outside it, so the close
  // handling can leave focus where that press put it instead of pulling it back to this chip.
  const dismissedByOutsidePointerRef = useRef(false);

  // The popover's own open auto-focus is left in place: it focuses and selects the panel's first
  // tabbable element (this input — the label above it is not tabbable) with `preventScroll`, which
  // is exactly what this panel wants on open. Focusing the input from a mount effect here instead
  // would silently do nothing: the panel is portaled, and Radix's portal renders no children until
  // its own layout effect has run, so on the commit this component mounts there is no input yet.

  /** Collapses leading/trailing and repeated internal whitespace to a single space. */
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

  // Whether the draft matches the pre-filled value. Every commit path tests this one value, so they
  // can never disagree about what counts as an edit. Whitespace is
  // normalized because the save path splits on /\s+/, so differing spacing yields identical forms —
  // comparing normalized text avoids a no-op persistence round-trip.
  const isUnedited = normalize(draft) === normalize(initialValue);

  // An empty draft has no interpretation at all, so it blocks the commit outright rather than
  // resolving to a save, a dismissal, or a reset.
  const normalized = normalize(draft);
  const forms = normalized === '' ? [] : normalized.split(' ');
  const isEmpty = forms.length === 0;

  // A single morpheme equal to the whole word records no segmentation, so it is never saved: with
  // an existing breakdown it is a request for the unsegmented state (a reset), and without one
  // there is nothing to remove, so committing it merely dismisses.
  const isWholeWord = forms.length === 1 && forms[0] === normalize(surfaceText);
  const isResetRequest = !!onReset && isWholeWord;

  /**
   * Removes the breakdown and closes, or swaps the panel into the confirmation first when the reset
   * would discard glosses no other token holds. Every reset request routes through here, so they
   * can never disagree about when a reset needs confirming.
   */
  const requestReset = () => {
    if (needsResetConfirm) {
      setConfirmingReset(true);
      return;
    }
    onReset?.();
    onClose();
  };

  /**
   * Resolves the current draft: an empty draft does nothing, a request for the whole word resets
   * the breakdown, an unedited draft over an existing breakdown dismisses without rewriting
   * identical data, and anything else saves. Closes the popover except when a reset is waiting on
   * its confirmation.
   */
  const handleSave = () => {
    if (isEmpty) return;
    if (isResetRequest) {
      requestReset();
      return;
    }
    if (isWholeWord || (onReset && isUnedited)) {
      onClose();
      return;
    }
    onSave(draft.trim());
    onClose();
  };

  /** Handles Enter to commit. Escape is handled by the popover itself (`onEscapeKeyDown`). */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  /**
   * Commits the draft when the user presses the pointer outside the popover, except when the text
   * was not edited — then the interaction acts like Cancel, because an accidental outside click is
   * not a deliberate commit. An empty draft is likewise dismissed without writing: the commit path
   * refuses to interpret it and would otherwise leave the panel open, but an outside click on a
   * modal popover must always dismiss. While the reset confirmation is showing, an outside click
   * dismisses it without resetting: the confirmation exists precisely because the loss is
   * irreversible, so it must not be answered by a stray click.
   *
   * Wired to `onPointerDownOutside` rather than the broader `onInteractOutside`, which also fires
   * when focus merely moves outside the panel. A modal popover is not supposed to dismiss on that
   * (Radix's modal content cancels its own focus-outside dismissal), but `onInteractOutside` runs
   * regardless of that cancellation — so listening to it would let any stray focus move commit the
   * user's draft and close the panel.
   */
  const handlePointerDownOutside = () => {
    dismissedByOutsidePointerRef.current = true;
    if (confirmingReset || isUnedited || isEmpty) {
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
   * A dismissal by pointer press outside the panel is exempt: that press has already put focus
   * where the user aimed it (typically another token), so pulling focus back to this chip would
   * yank it out of whatever they just clicked. The default is still prevented, so Radix does not
   * restore focus to the pre-open element either — the click's own focus stands.
   */
  const handleCloseAutoFocus = (e: Event) => {
    e.preventDefault();
    if (dismissedByOutsidePointerRef.current) return;
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
      className="tw:w-auto tw:min-w-48 tw:gap-1.5 tw:p-2"
      onClick={stopMouseEvents}
      onCloseAutoFocus={handleCloseAutoFocus}
      onEscapeKeyDown={onClose}
      onPointerDownOutside={handlePointerDownOutside}
      onMouseDown={stopMouseEvents}
    >
      {confirmingReset ? (
        <>
          <p className="tw:text-xs tw:text-muted-foreground" data-testid="morpheme-reset-confirm">
            {localizedStrings['%interlinearizer_morphemeEditor_confirmResetPrompt%']}
          </p>
          <div className="tw:flex tw:justify-end tw:gap-1.5">
            <Button
              onClick={() => setConfirmingReset(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings['%interlinearizer_morphemeEditor_cancel%']}
            </Button>
            <Button
              className="tw:text-destructive"
              data-testid="morpheme-reset-confirm-action"
              onClick={() => {
                onReset?.();
                onClose();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings['%interlinearizer_morphemeEditor_confirmResetAction%']}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={inputId}>
            {localizedStrings['%interlinearizer_morphemeEditor_splitLabel%']}
          </Label>
          <Input
            className="tw:w-full tw:font-mono"
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            type="text"
          />
          {isEmpty && (
            <p className="tw:text-xs tw:text-muted-foreground" data-testid="morpheme-empty-hint">
              {localizedStrings['%interlinearizer_morphemeEditor_emptyHint%']}
            </p>
          )}
          <div className="tw:flex tw:justify-end tw:gap-1.5">
            {onReset && (
              <Button
                className="tw:me-auto tw:text-destructive"
                onClick={requestReset}
                size="sm"
                type="button"
                variant="outline"
              >
                {localizedStrings['%interlinearizer_morphemeEditor_reset%']}
              </Button>
            )}
            <Button onClick={onClose} size="sm" type="button" variant="outline">
              {localizedStrings['%interlinearizer_morphemeEditor_cancel%']}
            </Button>
            <Button disabled={isEmpty} onClick={handleSave} size="sm" type="button">
              {localizedStrings['%interlinearizer_morphemeEditor_done%']}
            </Button>
          </div>
        </>
      )}
    </PopoverContent>
  );
}
