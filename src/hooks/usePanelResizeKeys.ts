import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * How far one arrow-key press resizes the panel, as a share of the group. Matches the step the
 * platform handle takes, so an arrow moves the panel equally far whichever of the two answers it.
 */
const KEYBOARD_RESIZE_STEP = 0.05;

/**
 * Which way along the screen the handle travels to widen the panel: `-1` toward the screen's left,
 * `1` toward its right. Read afresh on each press, so a panel that outlives a change of interface
 * language resizes the way it is currently pointing.
 */
function widenTravel(): number {
  return document.documentElement.dir === 'rtl' ? 1 : -1;
}

/** Which way along the screen a key moves the handle, `0` for a key that moves it nowhere. */
function keyTravel(key: string): number {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return 0;
}

/**
 * Resizes a panel by key press: mirrored arrows for a right-to-left interface, and Home and End to
 * either end of the range. Handles only what the platform resize handle leaves undone, and yields
 * every other key to it, so the two together answer a full set.
 *
 * Sizes are shares of the group the panel is laid out in, `0.25` being a quarter of it.
 *
 * @param fraction - Share the panel currently holds, which a press resizes from.
 * @param onFractionChange - Records a share a press asked for. Not called for a press that would
 *   leave the panel where it already is.
 * @param bounds - Narrowest and widest shares a press may reach.
 * @returns A `keydown` handler for the resize handle.
 */
export default function usePanelResizeKeys(
  fraction: number,
  onFractionChange: (fraction: number) => void,
  bounds: { min: number; max: number },
): (event: ReactKeyboardEvent) => void {
  const { min, max } = bounds;

  return useCallback(
    (event: ReactKeyboardEvent) => {
      // The keys below are recognized by name alone, so a modified press — Alt+Arrow, which some
      // hosts navigate back on — would both resize the panel and swallow the host's shortcut.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const travel = keyTravel(event.key);
      // Left alone in a left-to-right interface, where the platform handle already reads these
      // arrows the way the panel is pointing; stepping here as well would move it twice.
      const mirrors = travel !== 0 && widenTravel() === 1;
      const jumpTarget =
        // eslint-disable-next-line no-nested-ternary
        event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
      if (!mirrors && jumpTarget === undefined) return;

      // Claims the press, which the platform handle honors by leaving a defaulted event alone.
      event.preventDefault();

      const next =
        jumpTarget ??
        Math.min(max, Math.max(min, fraction + travel * widenTravel() * KEYBOARD_RESIZE_STEP));
      // An arrow held down at an end of the range repeats, and each repeat would otherwise put an
      // unchanged layout through the store.
      if (next !== fraction) onFractionChange(next);
    },
    [fraction, onFractionChange, min, max],
  );
}
