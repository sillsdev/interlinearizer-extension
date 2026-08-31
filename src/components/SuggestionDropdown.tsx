import { PopoverContent } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useLayoutEffect } from 'react';
import { STATUS_TEXT_COLOR_CLASS } from '../types/status-colors';
import type { GlossedSuggestionEntry } from '../utils/suggestion-engine';

/** Props for {@link SuggestionDropdown}. */
type SuggestionDropdownProps = Readonly<{
  /** The listbox element id, matching the input's `aria-controls`. */
  listboxId: string;
  /**
   * Maps a row index to its option element id, matching the input's `aria-activedescendant`. Owned
   * by the chip so the input and the options agree on ids.
   */
  optionId: (index: number) => string;
  /** The glossed suggestion entries to render, in rank order (the suggested pick first). */
  entries: readonly GlossedSuggestionEntry[];
  /** The keyboard-highlighted row, or -1 when none is highlighted (Enter then picks the top row). */
  activeIndex: number;
  /**
   * Accessible label for an "accept the suggested gloss" row, with `{token}` and `{gloss}` still to
   * fill in.
   */
  acceptLabelTemplate: string;
  /** Same as {@link acceptLabelTemplate}, for a "promote this candidate gloss" row. */
  promoteLabelTemplate: string;
  /**
   * Accessible suffix naming a row's morpheme breakdown, with `{breakdown}` still to fill in.
   * Appended to the label of each row carrying one, so same-gloss rows do not sound identical.
   */
  breakdownLabelTemplate: string;
  /** Surface form of the token being glossed, filling `{token}` in the accept and promote templates. */
  tokenSurfaceText: string;
  /** Called with a row index when the pointer enters it, so hover and keyboard share one highlight. */
  onActiveIndexChange: (index: number) => void;
  /** Called with a payload id when a row is chosen (approve the suggested / promote a candidate). */
  onSelect: (id: string) => void;
}>;

/**
 * The pop-down listbox a token chip shows while its gloss input is the active combobox. Every bit
 * of combobox state — open, active row, keyboard — arrives as props; this holds none of it.
 *
 * Must be rendered inside a popover anchored on the gloss field: the panel stays with that field as
 * the view scrolls it, and escapes the clipping and stacking of the interlinear view's scroll
 * viewports and token rows.
 *
 * Each row is colored and labeled by its own `status` — `'suggested'` (blue, "accept") or
 * `'candidate'` (gray, "promote") — carried on the entry rather than inferred from position, so a
 * dropped blank-in-language pick can never leave a candidate masquerading as the accept row.
 *
 * A row also renders its `breakdown` when it carries one, so two analyses glossed alike are never
 * offered as identical choices.
 */
export default function SuggestionDropdown({
  listboxId,
  optionId,
  entries,
  activeIndex,
  acceptLabelTemplate,
  promoteLabelTemplate,
  breakdownLabelTemplate,
  tokenSurfaceText,
  onActiveIndexChange,
  onSelect,
}: SuggestionDropdownProps) {
  // Keep the keyboard-highlighted row inside the panel's scroll window, which arrow navigation
  // otherwise walks straight past. block: 'nearest' only scrolls when the row is actually clipped,
  // so an in-view row stays put. The row is found by id because the panel element belongs to the
  // popover.
  //
  // On the first commit the popover has portaled nothing yet, so the lookup finds no row. That is
  // harmless only because every path that opens the panel highlights no row, taking the early
  // return; an open path arriving with a row already highlighted would silently fail to scroll.
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, optionId, entries]);

  return (
    // `role` and `id` are spread onto the panel after the popover's own dialog role and id, so they
    // win and the gloss input's aria-controls resolves to a real listbox. The class overrides shed
    // the menu-sized content defaults this row list does not want.
    //
    // Row mouse events are left to bubble: they reach the chip label, whose own handling focuses the
    // gloss input — where focus belongs the whole time this panel is open.
    <PopoverContent
      className="tw:max-h-48 tw:w-auto tw:gap-0 tw:overflow-y-auto tw:px-0 tw:py-1"
      // The panel follows its anchor, so a token scrolled out of the interlinear viewport would
      // leave it parked at the viewport edge with nothing under it. Hiding on detach keeps the panel
      // open and focused, and scrolling the token back restores it; dismissing instead would strand
      // the still-focused input on a collapsed combobox.
      hideWhenDetached
      id={listboxId}
      role="listbox"
      // The popover publishes its anchor's width on the panel; using it as the floor keeps the panel
      // from rendering narrower than that anchor — the span wrapping the gloss field, whose width is
      // the field's own only because the button inside it is absolutely positioned and out of flow.
      // The variable is only set once the popover has run its first (async) positioning pass, so the
      // very first paint can fall back to the panel's auto width before snapping to the field.
      style={{ minWidth: 'var(--radix-popover-trigger-width)' }}
      // Both focus events are suppressed so the panel never moves DOM focus, which the combobox
      // depends on: focus belongs to the gloss input the whole time the panel is open, and the
      // panel closes on that input's blur — by which point focus is wherever the user aimed it.
      onCloseAutoFocus={(e) => e.preventDefault()}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          aria-label={
            formatReplacementString(
              entry.status === 'suggested' ? acceptLabelTemplate : promoteLabelTemplate,
              { gloss: entry.gloss, token: tokenSurfaceText },
            ) +
            (entry.breakdown === undefined
              ? ''
              : `, ${formatReplacementString(breakdownLabelTemplate, {
                  breakdown: entry.breakdown,
                })}`)
          }
          aria-selected={index === activeIndex}
          className={`tw:cursor-pointer tw:whitespace-nowrap tw:px-3 tw:py-0.5 tw:text-sm tw:italic ${STATUS_TEXT_COLOR_CLASS[entry.status]}${index === activeIndex ? ' tw:bg-accent' : ''}`}
          data-testid={entry.status === 'suggested' ? 'suggestion-accept' : 'suggestion-candidate'}
          id={optionId(index)}
          role="option"
          // An option role must be focusable, though nothing focuses a row: the gloss input holds
          // focus and marks the active row with aria-activedescendant.
          tabIndex={-1}
          // Select on mouse-down, suppressing its default focus shift, so choosing a row never blurs
          // the gloss input (the input keeps focus for the combobox) and the keyboard path stays the
          // only place Enter/arrow handling lives.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entry.id);
          }}
          onMouseEnter={() => onActiveIndexChange(index)}
        >
          {entry.gloss}
          {entry.breakdown !== undefined && (
            // Hidden from assistive tech because the row's own label already speaks the breakdown,
            // which would otherwise be announced twice.
            <span
              aria-hidden
              className="tw:ms-2 tw:text-xs tw:not-italic tw:text-muted-foreground"
              data-testid="suggestion-breakdown"
            >
              {entry.breakdown}
            </span>
          )}
        </div>
      ))}
    </PopoverContent>
  );
}
