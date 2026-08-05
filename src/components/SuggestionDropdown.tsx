import { PopoverContent } from 'platform-bible-react';
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
  /** The token's surface form, used only to build per-row accessible labels. */
  surfaceText: string;
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
 * `'candidate'` (grey, "promote") — carried on the entry rather than inferred from position, so a
 * dropped blank-in-language pick can never leave a candidate masquerading as the accept row.
 */
export default function SuggestionDropdown({
  listboxId,
  optionId,
  entries,
  activeIndex,
  surfaceText,
  onActiveIndexChange,
  onSelect,
}: SuggestionDropdownProps) {
  // Keep the keyboard-highlighted row inside the panel's scroll window, which arrow navigation
  // otherwise walks straight past. block: 'nearest' only scrolls when the row is actually clipped,
  // so an in-view row stays put. The row is found by id because the panel element belongs to the
  // popover.
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, optionId, entries]);

  return (
    // `role` and `id` are spread onto the panel after the popover's own dialog role and id, so they
    // win and the gloss input's aria-controls resolves to a real listbox. The class overrides shed
    // the menu-sized content defaults this row list does not want.
    <PopoverContent
      className="tw:max-h-48 tw:w-auto tw:gap-0 tw:overflow-y-auto tw:p-0 tw:py-1"
      id={listboxId}
      role="listbox"
      // The popover publishes its anchor's width on the panel; using it as the floor keeps the
      // panel from rendering narrower than the gloss field.
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
            entry.status === 'suggested'
              ? `Accept suggestion ${entry.gloss} for ${surfaceText}`
              : `Promote ${entry.gloss} for ${surfaceText}`
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
        </div>
      ))}
    </PopoverContent>
  );
}
