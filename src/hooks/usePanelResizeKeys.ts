import { readDirection } from 'platform-bible-react/experimental';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How far one arrow-key press resizes the panel, as a percentage of the group. Matches the step the
 * platform handle takes, so an arrow moves the panel equally far whichever of the two answers it.
 */
const KEYBOARD_RESIZE_STEP = 5;

/**
 * How far one jump-key press resizes the panel. Farther than the widest panel, so a press lands
 * against whichever bound it points at rather than part way to it.
 */
const KEYBOARD_JUMP_STEP = 100;

/**
 * Which way along the screen the handle travels to widen the panel: `-1` toward the screen's left,
 * `1` toward its right. Read afresh on each press, so a panel that outlives a change of interface
 * language resizes the way it is currently pointing.
 */
function widenTravel(): number {
  return readDirection() === 'rtl' ? 1 : -1;
}

/** Which way along the screen a key moves the handle, `0` for a key that moves it nowhere. */
function keyTravel(key: string): { travel: number; step: number } {
  if (key === 'ArrowLeft') return { travel: -1, step: KEYBOARD_RESIZE_STEP };
  if (key === 'ArrowRight') return { travel: 1, step: KEYBOARD_RESIZE_STEP };
  // Jump keys travel the way the arrow beside them points: `Home` toward the screen's left, `End`
  // toward its right.
  if (key === 'Home') return { travel: -1, step: KEYBOARD_JUMP_STEP };
  if (key === 'End') return { travel: 1, step: KEYBOARD_JUMP_STEP };
  return { travel: 0, step: 0 };
}

/**
 * Resizes a panel by arrow or jump key in a right-to-left interface, where the platform handle
 * would otherwise move it the wrong way: the handle steps by a signed amount that never consults
 * the interface direction, so an arrow pointing at the panel's own edge widens it instead of
 * narrowing it, and `Home`/`End` land against the bound opposite the arrow beside them. Every other
 * key, and every key in a left-to-right interface, is left to the handle.
 *
 * Returns a ref rather than a handler because the platform binds its own key handler to the
 * handle's element directly, and only a listener on that element in the capture phase runs early
 * enough to claim a press before it. A press claimed too late is stepped twice, once by each.
 *
 * Sizes are percentages of the group the panel is laid out in, `25` being a quarter of it, matching
 * the unit a platform group lays out in and hands back.
 *
 * A press is aimed at the whole range rather than at the panel's own size limits, those being
 * expressed in pixels and so resolvable only by the group, which clamps what it is handed to them.
 *
 * @param percentage - Percentage the panel currently holds, which a press resizes from. The width
 *   the group settled on rather than one asked of it, so that a press against a limit steps from
 *   where the panel actually is.
 * @param onPercentageChange - Records a percentage a press asked for. Not called for a press that
 *   would leave the panel where it already is.
 * @returns A ref for the resize handle's element.
 */
export default function usePanelResizeKeys(
  percentage: number,
  onPercentageChange: (percentage: number) => void,
): (element: HTMLElement | null) => void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // The keys below are recognized by name alone, so a modified press — Alt+Arrow, which some
      // hosts navigate back on — would both resize the panel and swallow the host's shortcut.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const { travel, step } = keyTravel(event.key);
      // Left alone in a left-to-right interface, where the platform handle already reads these
      // keys the way the panel is pointing; stepping here as well would move it twice.
      if (travel === 0 || widenTravel() !== 1) return;

      // Claims the press before the platform's own handler sees it, that handler starting by
      // returning on an event already defaulted.
      event.preventDefault();

      // Past the gate the handle widens toward the screen's right, so a key traveling that way
      // widens the panel and one traveling the other narrows it.
      const next = Math.min(100, Math.max(0, percentage + travel * step));
      // A key pressed at the end of the range it moves toward — an arrow held down there repeating,
      // or a jump key aimed at it — would otherwise put an unchanged layout through the store.
      if (next !== percentage) onPercentageChange(next);
    },
    [percentage, onPercentageChange],
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
