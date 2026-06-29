/**
 * @file The pop-down listbox a {@link TokenChip} shows while its gloss input is the active combobox.
 *   Rendering and positioning live here; the combobox state (open, active row, keyboard) is owned
 *   by the chip, which drives this purely through props. Portaled to `document.body` so it escapes
 *   the clipping and stacking of the interlinear view's scroll viewports and token-row stacking
 *   contexts.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { statusTextColorClass } from '../utils/status-colors';
import type { GlossedSuggestionEntry } from '../utils/suggestion-engine';

/** Props for {@link SuggestionDropdown}. */
type SuggestionDropdownProps = Readonly<{
  /**
   * The gloss input this dropdown anchors under. Read on open (and window resize) to position the
   * panel; never focused or mutated here so DOM focus stays in the input for the combobox.
   */
  anchorRef: Readonly<{ current: HTMLInputElement | undefined }>;
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
  /** Called when the dropdown should close itself (the user scrolled the view away). */
  onRequestClose: () => void;
}>;

/**
 * Renders the portaled suggestion listbox for a token's gloss combobox. Each row is colored and
 * labeled by its own `status` — `'suggested'` (green, "accept") or `'candidate'` (blue, "promote")
 * — carried on the entry rather than inferred from row position, so a dropped blank-in-language
 * pick can never leave a candidate masquerading as the accept row. The keyboard-active row gets the
 * same `bg-accent` background hovering applies, and hovering a row sets the active index so only
 * one row is ever highlighted. Each row suppresses its mouse-down default so clicking it never
 * blurs the input — focus stays in the input and the click selects instead. The panel closes itself
 * on outer scrolling (the anchor would drift); scrolling the panel's own overflow is ignored so a
 * long list can be scrolled without dismissing it.
 *
 * @param props - Component props (see {@link SuggestionDropdownProps}).
 * @returns A `document.body` portal containing the listbox, positioned under the anchor input.
 */
export default function SuggestionDropdown({
  anchorRef,
  listboxId,
  optionId,
  entries,
  activeIndex,
  surfaceText,
  onActiveIndexChange,
  onSelect,
  onRequestClose,
}: SuggestionDropdownProps) {
  const listRef = useRef<HTMLUListElement | undefined>(undefined);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  /**
   * Ref callback that stores the list element, used to tell apart scrolling the panel's own
   * overflow (ignored) from outer scrolling (closes). Normalizes React's `null` on unmount to
   * `undefined`.
   *
   * @param el - The mounted list, or `null` on unmount.
   */
  const setListRef = (el: HTMLUListElement | null) => {
    listRef.current = el ?? undefined;
  };

  // Position the panel under the anchor on open and keep it glued there across window resizes and
  // outer scrolling. The continuous view smooth-scrolls the token strip to center a phrase whenever
  // a token's gloss input is focused — the same focus that opens this dropdown — so closing on outer
  // scroll would dismiss the panel the instant it appeared. Instead we reposition under the anchor as
  // it moves, then close only once the anchor has scrolled out of the viewport (a far user scroll
  // that abandons this token). A capture listener catches scrolls of ancestor viewports; scrolls of
  // the panel's own overflow are ignored so a long list can be scrolled without moving or closing it.
  // Layout effect so the first measurement runs before paint — otherwise the portaled panel flashes
  // at the default top-left before snapping under the anchor.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    /* v8 ignore next -- the chip only mounts this while the input (the anchor) is rendered */
    if (!anchor) return undefined;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition({ top: rect.bottom + 2, left: rect.left });
    };
    updatePosition();
    const handleScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      const rect = anchor.getBoundingClientRect();
      // The anchor has scrolled out of view: there is nothing to glue to, so dismiss the panel.
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        onRequestClose();
        return;
      }
      setPosition({ top: rect.bottom + 2, left: rect.left });
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [anchorRef, onRequestClose]);

  // Keep the keyboard-highlighted row inside the panel's scroll window. Arrow navigation moves
  // activeIndex past the visible edge of the max-h-48 overflow without this; scrollIntoView with
  // block: 'nearest' only scrolls when the row is actually clipped, so it leaves an in-view row put.
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const active = listRef.current?.querySelector(`#${CSS.escape(optionId(activeIndex))}`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, optionId, entries]);

  return createPortal(
    <ul
      ref={setListRef}
      className="tw:fixed tw:z-30 tw:max-h-48 tw:overflow-y-auto tw:rounded-md tw:border tw:border-border tw:bg-popover tw:py-1 tw:shadow-md"
      id={listboxId}
      role="listbox"
      style={{ top: position.top, left: position.left }}
    >
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          aria-label={
            entry.status === 'suggested'
              ? `Accept suggestion ${entry.gloss} for ${surfaceText}`
              : `Promote ${entry.gloss} for ${surfaceText}`
          }
          aria-selected={index === activeIndex}
          className={`tw:cursor-pointer tw:whitespace-nowrap tw:px-2 tw:py-0.5 tw:text-sm tw:italic ${statusTextColorClass(entry.status)}${index === activeIndex ? ' tw:bg-accent' : ''}`}
          data-testid={entry.status === 'suggested' ? 'suggestion-accept' : 'suggestion-candidate'}
          id={optionId(index)}
          role="option"
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
        </li>
      ))}
    </ul>,
    document.body,
  );
}
