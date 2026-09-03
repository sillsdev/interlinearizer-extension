import { useLocalizedStrings } from '@papi/frontend/react';
import type { MorphemeAnalysis } from 'interlinearizer';
import { Button, Input, Label, PopoverContent } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { morphemeFormsLostByResplit } from '../store/analysisSlice';

const POPOVER_STRING_KEYS = [
  '%interlinearizer_morphemeEditor_splitLabel%',
  '%interlinearizer_morphemeEditor_reset%',
  '%interlinearizer_morphemeEditor_cancel%',
  '%interlinearizer_morphemeEditor_done%',
  '%interlinearizer_morphemeEditor_emptyHint%',
  '%interlinearizer_morphemeEditor_confirmResetPrompt%',
  '%interlinearizer_morphemeEditor_confirmResetAction%',
  '%interlinearizer_morphemeEditor_confirmResplitPrompt%',
  '%interlinearizer_morphemeEditor_confirmResplitAction%',
] as const satisfies `%${string}%`[];

/** The wording the panel renders, so an edit carrying different consequences can say so. */
export type MorphemeEditorLabels = Readonly<{
  splitLabel: string;
  reset: string;
  cancel: string;
  done: string;
  emptyHint: string;
  confirmResetPrompt: string;
  confirmResetAction: string;
  /** Takes a `{forms}` replacement naming the glossed forms the save would strand. */
  confirmResplitPrompt: string;
  confirmResplitAction: string;
}>;

/** The panel's own wording, for a caller that overrides none of it. */
function defaultLabels(strings: LanguageStrings): MorphemeEditorLabels {
  return {
    splitLabel: strings['%interlinearizer_morphemeEditor_splitLabel%'],
    reset: strings['%interlinearizer_morphemeEditor_reset%'],
    cancel: strings['%interlinearizer_morphemeEditor_cancel%'],
    done: strings['%interlinearizer_morphemeEditor_done%'],
    emptyHint: strings['%interlinearizer_morphemeEditor_emptyHint%'],
    confirmResetPrompt: strings['%interlinearizer_morphemeEditor_confirmResetPrompt%'],
    confirmResetAction: strings['%interlinearizer_morphemeEditor_confirmResetAction%'],
    confirmResplitPrompt: strings['%interlinearizer_morphemeEditor_confirmResplitPrompt%'],
    confirmResplitAction: strings['%interlinearizer_morphemeEditor_confirmResplitAction%'],
  };
}

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
 * this token solely owns. A re-split that strands a glossed form confirms on the same terms, naming
 * the forms whose glosses it is about to drop, since losing some of a breakdown is as irreversible
 * as losing all of it. The confirmation replaces the panel's own content rather than opening a
 * second surface: the panel is portaled to `document.body`, so it floats over the token chip and
 * cannot reflow it, and nesting a modal inside this already-modal popover would stack two focus
 * traps.
 *
 * Renders the content of a `platform-bible-react` `Popover`; the caller owns the `Popover` root and
 * the `PopoverAnchor` the panel is positioned from, and must render this component only while the
 * popover is open so the draft state re-initializes from `initialValue` on every open. The popover
 * is modal, so interactions outside the panel are blocked while it is open.
 *
 * The draft is held here unless the caller passes `draft` and `onDraftChange`, which hand it up
 * instead — for a caller that outlives this panel and must keep an unsaved re-segmentation across
 * its own unmounting, since the draft commits on neither blur nor unmount.
 */
export function MorphemeBreakdownPopover({
  initialValue,
  draft: controlledDraft,
  onDraftChange,
  onSave,
  onClose,
  onReset,
  needsResetConfirm = false,
  morphemes = [],
  surfaceText,
  glossInputId,
  labels,
}: Readonly<{
  /**
   * Pre-filled text for the input (current morpheme forms joined by spaces, or the full surface
   * text when no breakdown exists yet). Ignored while the draft is controlled, the caller having
   * seeded its own.
   */
  initialValue: string;
  /** The draft text, when the caller holds it. Omit to let the editor hold its own. */
  draft?: string;
  /** Records an edit to a controlled draft. Required with `draft`, ignored without it. */
  onDraftChange?: (draft: string) => void;
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
   * The token's current morphemes, which a re-split is weighed against to find the glossed forms it
   * would strand. Pass them only when this token solely owns its payload; a shared payload is
   * forked rather than re-segmented in place, so nothing it drops is lost project-wide and the
   * default empty list correctly reports no loss.
   */
  morphemes?: readonly MorphemeAnalysis[];
  /**
   * The token's surface text, used to recognize a "breakdown" that is just the whole word as a
   * single morpheme (a request to reset).
   */
  surfaceText: string;
  /**
   * Id of the token's gloss input; used to locate the chip on close so focus lands on its first
   * morpheme gloss field (falling back to the gloss input itself), rather than on the non-tabbable
   * morpheme trigger. Omit where the panel opens from no such chip, leaving focus restoration to
   * the popover's own default.
   */
  glossInputId?: string;
  /**
   * Overrides for the panel's wording, for a caller whose edit means something other than
   * re-splitting the one token in hand. Defaults to the panel's own.
   */
  labels?: MorphemeEditorLabels;
}>) {
  const [defaultStrings] = useLocalizedStrings(POPOVER_STRING_KEYS);
  const inputId = useId();
  const [uncontrolledDraft, setUncontrolledDraft] = useState(initialValue);
  const draft = controlledDraft ?? uncontrolledDraft;
  const setDraft = (value: string) => {
    if (onDraftChange) onDraftChange(value);
    else setUncontrolledDraft(value);
  };
  const localizedStrings = labels ?? defaultLabels(defaultStrings);
  /** Which loss the reader is being asked to confirm, or `undefined` while the editor is showing. */
  const [confirming, setConfirming] = useState<'reset' | 'resplit' | undefined>(undefined);
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
      setConfirming('reset');
      return;
    }
    onReset?.();
    onClose();
  };

  // The glossed forms this draft would strand. Empty for a shared payload, whose morphemes are
  // withheld, because the write forks it rather than re-segmenting what the others read.
  const lostForms = morphemeFormsLostByResplit(morphemes, forms);

  const writeResplit = () => {
    onSave(draft.trim());
    onClose();
  };

  /**
   * Resolves the current draft: an empty draft does nothing, a request for the whole word resets
   * the breakdown, an unedited draft over an existing breakdown dismisses without rewriting
   * identical data, and anything else saves — first confirming when the save would strand a glossed
   * form. Closes the popover except while a confirmation is pending.
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
    if (lostForms.length > 0) {
      setConfirming('resplit');
      return;
    }
    writeResplit();
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
   * modal popover must always dismiss. While either confirmation is showing, an outside click
   * dismisses it without writing: a confirmation exists precisely because the loss is irreversible,
   * so it must not be answered by a stray click.
   *
   * Wired to `onPointerDownOutside` rather than the broader `onInteractOutside`, which also fires
   * when focus merely moves outside the panel. A modal popover is not supposed to dismiss on that
   * (Radix's modal content cancels its own focus-outside dismissal), but `onInteractOutside` runs
   * regardless of that cancellation — so listening to it would let any stray focus move commit the
   * user's draft and close the panel.
   */
  const handlePointerDownOutside = () => {
    dismissedByOutsidePointerRef.current = true;
    if (confirming || isUnedited || isEmpty) {
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
   *
   * With no gloss input named there is no chip to land in, so the popover's own focus restoration
   * is left alone.
   */
  const handleCloseAutoFocus = (e: Event) => {
    if (glossInputId === undefined) return;
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
      {confirming ? (
        <>
          <p
            className="tw:text-xs tw:text-muted-foreground"
            data-testid={
              confirming === 'reset' ? 'morpheme-reset-confirm' : 'morpheme-split-confirm'
            }
          >
            {confirming === 'reset'
              ? localizedStrings.confirmResetPrompt
              : formatReplacementString(localizedStrings.confirmResplitPrompt, {
                  forms: lostForms.join(', '),
                })}
          </p>
          <div className="tw:flex tw:justify-end tw:gap-1.5">
            <Button
              data-testid="morpheme-breakdown-confirm-cancel"
              onClick={() => setConfirming(undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings.cancel}
            </Button>
            <Button
              className="tw:text-destructive"
              data-testid={
                confirming === 'reset'
                  ? 'morpheme-reset-confirm-action'
                  : 'morpheme-split-confirm-action'
              }
              onClick={
                confirming === 'reset'
                  ? () => {
                      onReset?.();
                      onClose();
                    }
                  : writeResplit
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {confirming === 'reset'
                ? localizedStrings.confirmResetAction
                : localizedStrings.confirmResplitAction}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={inputId}>
            {localizedStrings.splitLabel}
          </Label>
          <Input
            className="tw:w-full tw:font-mono"
            data-testid="morpheme-breakdown-input"
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            type="text"
          />
          {isEmpty && (
            <p className="tw:text-xs tw:text-muted-foreground" data-testid="morpheme-empty-hint">
              {localizedStrings.emptyHint}
            </p>
          )}
          <div className="tw:flex tw:justify-end tw:gap-1.5">
            {onReset && (
              <Button
                className="tw:me-auto tw:text-destructive"
                data-testid="morpheme-breakdown-reset"
                onClick={requestReset}
                size="sm"
                type="button"
                variant="outline"
              >
                {localizedStrings.reset}
              </Button>
            )}
            <Button
              data-testid="morpheme-breakdown-cancel"
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings.cancel}
            </Button>
            <Button
              data-testid="morpheme-breakdown-save"
              disabled={isEmpty}
              onClick={handleSave}
              size="sm"
              type="button"
            >
              {localizedStrings.done}
            </Button>
          </div>
        </>
      )}
    </PopoverContent>
  );
}
