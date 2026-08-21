import { readDirection } from 'platform-bible-react/experimental';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How far one arrow-key press resizes the panel, as a percentage of the group. Matches the step the
 * platform handle takes, so an arrow moves the panel equally far whichever of the two answers it.
 */
const KEYBOARD_RESIZE_STEP = 5;

/**
 * Which way along the screen the handle travels to widen the panel: `-1` toward the screen's left,
 * `1` toward its right. Read afresh on each press, so a panel that outlives a change of interface
 * language resizes the way it is currently pointing.
 */
function widenTravel(): number {
  return readDirection() === 'rtl' ? 1 : -1;
}

/** Which way along the screen a key moves the handle, `0` for a key that moves it nowhere. */
function keyTravel(key: string): number {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return 0;
}

/**
 * Resizes a panel by arrow key in a right-to-left interface, where the platform handle would
 * otherwise move it the wrong way: the handle steps by a signed amount that never consults the
 * interface direction, so an arrow pointing at the panel's own edge widens it instead of narrowing
 * it. Every other key, and every arrow in a left-to-right interface, is left to the handle.
 *
 * Returns a ref rather than a handler because the platform binds its own key handler to the
 * handle's element directly, and only a listener on that element in the capture phase runs early
 * enough to claim a press before it. A press claimed too late is stepped twice, once by each.
 *
 * Sizes are percentages of the group the panel is laid out in, `25` being a quarter of it, matching
 * the unit a platform group lays out in and hands back.
 *
 * @param percentage - Percentage the panel currently holds, which a press resizes from.
 * @param onPercentageChange - Records a percentage a press asked for. Not called for a press that
 *   would leave the panel where it already is.
 * @param bounds - Narrowest and widest percentages a press may reach.
 * @returns A ref for the resize handle's element.
 */
export default function usePanelResizeKeys(
  percentage: number,
  onPercentageChange: (percentage: number) => void,
  bounds: { min: number; max: number },
): (element: HTMLElement | null) => void {
  const { min, max } = bounds;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // The arrows below are recognized by name alone, so a modified press — Alt+Arrow, which some
      // hosts navigate back on — would both resize the panel and swallow the host's shortcut.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const travel = keyTravel(event.key);
      // Left alone in a left-to-right interface, where the platform handle already reads these
      // arrows the way the panel is pointing; stepping here as well would move it twice.
      if (travel === 0 || widenTravel() !== 1) return;

      // Claims the press before the platform's own handler sees it, that handler starting by
      // returning on an event already defaulted.
      event.preventDefault();

      const next = Math.min(
        max,
        Math.max(min, percentage + travel * widenTravel() * KEYBOARD_RESIZE_STEP),
      );
      // An arrow held down at an end of the range repeats, and each repeat would otherwise put an
      // unchanged layout through the store.
      if (next !== percentage) onPercentageChange(next);
    },
    [percentage, onPercentageChange, min, max],
  );

  // Read through a ref so a press runs the current handler without the listener being rebound for
  // every resize, which would rebind it under a held-down arrow.
  const handlerRef = useRef(handleKeyDown);
  handlerRef.current = handleKeyDown;

  // Held in state rather than a ref so that attaching the listener re-runs once the handle mounts;
  // a ref filled in during commit would change without rendering, leaving the effect never re-run.
  // eslint-disable-next-line no-null/no-null
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!element) return undefined;
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    element.addEventListener('keydown', listener, true);
    return () => element.removeEventListener('keydown', listener, true);
  }, [element]);

  return setElement;
}
