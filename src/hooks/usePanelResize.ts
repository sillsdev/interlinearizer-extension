import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

/** How far one arrow-key press resizes the panel, in pixels. */
const KEYBOARD_RESIZE_STEP_PX = 16;

/** `MouseEvent.button` for the primary button, the only one that drags the handle. */
const PRIMARY_MOUSE_BUTTON = 0;

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

/** Which way along the screen a key moves the handle, `0` for a key that moves it nowhere. */
function keyTravel(key: string): number {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return 0;
}

/**
 * The width a key sends the panel straight to, or `undefined` for a key that sends it nowhere. A
 * jump lands on an end of the range the splitter announces rather than on a side of the screen, so
 * unlike an arrow key it needs no mirroring for a right-to-left interface.
 */
function keyJumpTarget(key: string, min: number, max: number): number | undefined {
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return undefined;
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
  /** Begins a drag on a primary-button press, ignoring any other. Attach to the resize handle. */
  onMouseDown: (event: ReactMouseEvent) => void;
  /**
   * Resizes by one step per arrow key, or to an end of the range on Home/End. Attach to the resize
   * handle.
   */
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

/**
 * Drives a panel anchored to the container's end edge, resized in pixels by dragging a handle on
 * its start edge or by arrowing that handle once focused.
 *
 * The committed width is the caller's to hold and persist, and a drag stays local until released,
 * so a gesture crossing a hundred pixels reports once rather than once per frame — which matters
 * when the caller's store is the host's. A press that never moves reports nothing at all, and
 * neither does a key that leaves the width where it already is. An arrow key otherwise reports on
 * each press, save while a drag is holding the width. A width a drag reached and never released is
 * committed if the panel goes away under it.
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
      // The drag below asks only whether some button is held, so one begun by any other button
      // would follow the pointer to its release and commit the width it reached.
      if (event.button !== PRIMARY_MOUSE_BUTTON) return;
      // The width on screen rather than the committed one behind it: a drag starting from a
      // committed width the bounds disallow would jump to it on the press and then hold still until
      // the pointer had traveled the whole difference.
      const startWidth = clampWidth(width);
      dragOriginRef.current = {
        clientX: event.clientX,
        width: startWidth,
        widenTravel: widenTravel(),
      };
      setDragWidth(startWidth);
      // Suppresses the text selection a drag across the panel would otherwise sweep up.
      event.preventDefault();
    },
    [width, clampWidth],
  );

  // Runs the in-flight drag. Mounted only while one is in flight, so an idle panel listens to
  // nothing. The listeners sit on the window rather than the handle because the pointer leaves the
  // handle's box the moment the drag begins, and a release outside it must still end the drag.
  useEffect(() => {
    if (dragWidth === undefined) return undefined;

    const endDrag = () => {
      const committed = dragWidthRef.current;
      // Writing an unchanged width back would put a stray click on the handle through the store.
      if (committed !== undefined) onWidthChange(committed);
      setDragWidth(undefined);
      dragWidthRef.current = undefined;
      dragOriginRef.current = undefined;
    };

    const handleMouseUp = (event: MouseEvent) => {
      // A middle- or right-button click made mid-drag raises `mouseup` too, and ending the drag
      // there would commit the width it had reached and leave the pointer still holding a handle
      // the panel does not follow.
      if (event.button !== PRIMARY_MOUSE_BUTTON) return;
      endDrag();
    };

    const handleMouseMove = (event: MouseEvent) => {
      // A release the window never saw — one over a native menu, which takes the pointer with it —
      // would otherwise leave the drag running, resizing the panel under a pointer holding nothing
      // and committing that width at the next click anywhere. A move reporting no button held is
      // the only word the window gets of such a release.
      if (event.buttons === 0) {
        endDrag();
        return;
      }
      const origin = dragOriginRef.current;
      // The listener is mounted only with an origin already set, and whatever clears the origin
      // ends the drag too, so a move reaches this only in the window between that clear and this
      // listener's removal, which the re-render carrying it has yet to reach.
      /* v8 ignore next -- a test never interleaves a move into that window: the re-render lands first */
      if (!origin) return;
      const next = clampWidth(origin.width + origin.widenTravel * (event.clientX - origin.clientX));
      dragWidthRef.current = next;
      setDragWidth(next);
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

  /**
   * Latest `onWidthChange`, so the commit below can run for the hook's whole lifetime. An effect
   * keyed on the caller's callback tears down whenever its identity changes, committing a width
   * part-way through a gesture.
   */
  const onWidthChangeRef = useRef(onWidthChange);
  useEffect(() => {
    onWidthChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  // A drag stays local until released, so a panel unmounted while one is in flight would otherwise
  // discard the width the gesture reached and come back at the width it started from.
  useEffect(
    () => () => {
      const reached = dragWidthRef.current;
      if (reached !== undefined) onWidthChangeRef.current(reached);
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const travel = keyTravel(event.key);
      const jumpTarget = keyJumpTarget(event.key, min, max);
      if (travel === 0 && jumpTarget === undefined) return;
      // The pointer owns the width while it is held: a key press mid-drag would step off the width
      // the drag began at, which is neither what the panel is showing nor what the release is about
      // to commit. Read off a ref, so the handler stays stable across a drag's frames. The case is
      // unusual but reachable — the press that begins a drag suppresses the focus change, so the
      // handle has to have been tabbed to first.
      if (dragOriginRef.current) return;
      event.preventDefault();
      // The arrow that moves the handle the way a drag would widen the panel widens it too,
      // whichever side of the container the interface language anchors it to.
      const step = travel === widenTravel() ? 1 : -1;
      const next = jumpTarget ?? clampWidth(width + step * KEYBOARD_RESIZE_STEP_PX);
      // An arrow held down at an end of the range repeats, and each repeat would otherwise put the
      // same width through the store.
      if (next !== width) onWidthChange(next);
    },
    [width, onWidthChange, clampWidth, min, max],
  );

  // Clamped rather than passed through, so the bounds govern what is drawn and reported even when
  // a committed width arrives from outside them.
  return { displayWidth: dragWidth ?? clampWidth(width), onMouseDown, onKeyDown };
}
