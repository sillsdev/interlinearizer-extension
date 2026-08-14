import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

/** How far one arrow-key press resizes the panel, in pixels. */
const KEYBOARD_RESIZE_STEP_PX = 16;

/**
 * Which way along the screen the handle has to travel to widen the panel: `-1` toward smaller
 * `clientX`, `1` toward larger.
 *
 * The panel is anchored to the container's end edge, which the interface language decides the side
 * of. A function rather than a constant, so a panel that outlives a language change still resizes
 * the way it is pointing.
 */
function widenTravel(): number {
  return document.documentElement.dir === 'rtl' ? 1 : -1;
}

/** How wide a panel may be dragged. */
export interface PanelWidthBounds {
  /** Narrowest the panel may be dragged, in pixels. */
  min: number;
  /** Widest the panel may be dragged, in pixels. */
  max: number;
}

/** The width to draw now, and the handlers that change it. */
export interface PanelResize {
  /**
   * Width the panel should be drawn at: the committed width, or the in-flight one while a drag is
   * running.
   */
  displayWidth: number;
  /** Begins a drag. Attach to the resize handle. */
  onMouseDown: (event: ReactMouseEvent) => void;
  /** Resizes by one step per arrow key. Attach to the resize handle. */
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

/**
 * Drives a panel anchored to the container's end edge, resized in pixels by dragging a handle on
 * its start edge or by arrowing that handle once focused.
 *
 * The committed width is the caller's to hold and persist, and a drag stays local until released,
 * so a gesture crossing a hundred pixels reports once rather than once per frame — which matters
 * when the caller's store is the host's. A press that never moves reports nothing at all. An arrow
 * key reports on each press.
 */
export default function usePanelResize(
  width: number,
  onWidthChange: (width: number) => void,
  bounds: PanelWidthBounds,
): PanelResize {
  /** Width the panel is drawn at while a drag is in flight, or `undefined` when none is. */
  const [dragWidth, setDragWidth] = useState<number | undefined>(undefined);

  /** Where the in-flight drag started, the width it started from, and which way widens it. */
  const dragOriginRef = useRef<{ clientX: number; width: number; widenTravel: number } | undefined>(
    undefined,
  );

  /**
   * The width the in-flight drag has reached, or `undefined` until it moves. A release commits from
   * here because a state updater has to stay free of side effects — React may run one more than
   * once.
   */
  const dragWidthRef = useRef<number | undefined>(undefined);

  const { min, max } = bounds;

  /** Holds a width within the range a drag may reach. */
  const clampWidth = useCallback(
    (candidate: number) => Math.min(max, Math.max(min, candidate)),
    [min, max],
  );

  const onMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      dragOriginRef.current = { clientX: event.clientX, width, widenTravel: widenTravel() };
      setDragWidth(width);
      // Suppresses the text selection a drag across the panel would otherwise sweep up.
      event.preventDefault();
    },
    [width],
  );

  // Runs the in-flight drag. Mounted only while one is in flight, so an idle panel listens to
  // nothing. The listeners sit on the window rather than the handle because the pointer leaves the
  // handle's box the moment the drag begins, and a release outside it must still end the drag.
  useEffect(() => {
    if (dragWidth === undefined) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const origin = dragOriginRef.current;
      /* v8 ignore next -- the origin is set before this listener is ever mounted */
      if (!origin) return;
      const next = clampWidth(origin.width + origin.widenTravel * (event.clientX - origin.clientX));
      dragWidthRef.current = next;
      setDragWidth(next);
    };
    const handleMouseUp = () => {
      const committed = dragWidthRef.current;
      // Writing an unchanged width back would put a stray click on the handle through the store.
      if (committed !== undefined) onWidthChange(committed);
      setDragWidth(undefined);
      dragWidthRef.current = undefined;
      dragOriginRef.current = undefined;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // `dragWidth` is read only as the in-flight flag; listing its value as a dep would tear down
    // and remount both listeners on every frame of the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragWidth === undefined, onWidthChange, clampWidth]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // eslint-disable-next-line no-nested-ternary -- a two-key lookup reads worse as a map
      const travel = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (travel === 0) return;
      event.preventDefault();
      // The arrow that moves the handle the way a drag would widen the panel widens it too,
      // whichever side of the container the interface language anchors it to.
      const step = travel === widenTravel() ? 1 : -1;
      onWidthChange(clampWidth(width + step * KEYBOARD_RESIZE_STEP_PX));
    },
    [width, onWidthChange, clampWidth],
  );

  return { displayWidth: dragWidth ?? width, onMouseDown, onKeyDown };
}
