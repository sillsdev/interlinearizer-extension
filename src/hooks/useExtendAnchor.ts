import type { RefObject } from 'react';
import { useCallback, useMemo, useRef } from 'react';

/** The scroll axis a window grows along. */
export type ScrollAxis = 'vertical' | 'horizontal';

/** Return value of {@link useExtendAnchor}. */
export interface ExtendAnchor {
  /**
   * Records `el` and its position along the axis, just before an extend mutates the window. `el`
   * must survive the mutation. An anchor already pending is kept: one observer delivery can extend
   * both edges before a render, and the anchor measured before either is the one whose displacement
   * accounts for both.
   */
  record: (el: Element | undefined) => void;
  /**
   * Scrolls the container by however far the pending anchor moved, so it and everything visible
   * with it hold still across the mutation. Clears the anchor.
   *
   * @returns Whether an anchor was pending.
   */
  restore: () => boolean;
}

/**
 * Holds a scroll window still across an extend, whatever height or width the mutation added,
 * culled, or clamped at either end.
 *
 * The caller calls {@link ExtendAnchor.restore} from a layout effect on the range, so the correction
 * lands before the browser paints the mutated window.
 */
export default function useExtendAnchor(
  axis: ScrollAxis,
  containerRef: RefObject<HTMLElement | null | undefined>,
): ExtendAnchor {
  const pendingRef = useRef<{ el: Element; position: number } | undefined>(undefined);

  const positionOf = useCallback(
    (el: Element) => {
      const rect = el.getBoundingClientRect();
      return axis === 'vertical' ? rect.top : rect.left;
    },
    [axis],
  );

  const record = useCallback(
    (el: Element | undefined) => {
      if (el === undefined || pendingRef.current !== undefined) return;
      pendingRef.current = { el, position: positionOf(el) };
    },
    [positionOf],
  );

  const restore = useCallback(() => {
    const anchor = pendingRef.current;
    if (anchor === undefined) return false;
    pendingRef.current = undefined;
    const container = containerRef.current;
    /* v8 ignore next -- an extend only runs while the container is mounted */
    if (!container) return true;
    if (anchor.el.isConnected) {
      const delta = positionOf(anchor.el) - anchor.position;
      if (delta !== 0) {
        if (axis === 'vertical') container.scrollTop += delta;
        else container.scrollLeft += delta;
      }
    }
    return true;
  }, [axis, containerRef, positionOf]);

  return useMemo(() => ({ record, restore }), [record, restore]);
}
