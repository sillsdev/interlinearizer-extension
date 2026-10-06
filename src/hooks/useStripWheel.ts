import { useCallback, useEffect, type RefObject } from 'react';
import useLatestRef from './useLatestRef';

/**
 * How far the strip travels per pixel of wheel travel. Below 1:1 on purpose: the strip is a single
 * line of text, so a gesture a page absorbs unremarkably would sweep several viewports of phrases
 * past the reader, too fast to read.
 */
export const WHEEL_SCROLL_GAIN = 0.35;

/**
 * Furthest the strip travels on any one wheel event. A compositor coalesces events it could not
 * deliver, so a single one can carry thousands of pixels, often arriving after the fingers have
 * stopped. A per-event ceiling bounds that without bounding a sustained gesture, which keeps
 * delivering events while the fingers move.
 */
export const MAX_WHEEL_TRAVEL_PX = 60;

/**
 * Pixels a line-mode wheel delta stands for, sized so a notch reported in lines travels as far as
 * one reported in pixels.
 */
const WHEEL_LINE_HEIGHT_PX = 100 / 3;

/**
 * Pixels one unit of a wheel delta stands for, given the mode the event reports it in.
 *
 * @returns `1` for a pixel-mode delta, so an unrecognized mode is read at face value rather than
 *   scaled by a guess.
 */
function wheelDeltaScale(deltaMode: number, viewport: HTMLElement | null): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return WHEEL_LINE_HEIGHT_PX;
  /* v8 ignore next -- the viewport is attached whenever a wheel reaches this handler */
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return viewport?.clientWidth ?? 0;
  return 1;
}

/** Arguments for {@link useStripWheel}. */
export interface UseStripWheelArgs {
  /** Ref to the clipping viewport the wheel is listened on and scrolled. */
  viewportRef: RefObject<HTMLElement | null>;
  /** Whether the strip runs right-to-left, which inverts both its scroll range and a swipe's sense. */
  isRtl: boolean;
  /**
   * Called when a gesture takes the scroll position away from whatever was placing it. The hook
   * decides when that has happened; the caller decides what it means for its own centering.
   */
  onReaderTakeover: () => void;
}

/**
 * Gives the continuous strip its wheel: a notch delivered over it scrolls the strip and leaves the
 * focus alone, so a wheel behaves there the way it does over any other scrollable region.
 *
 * Every notch over the strip is claimed, including one that moves nothing — spent at a bound or on
 * a strip too short to scroll. Nothing above the strip would scroll to receive an unclaimed one
 * anyway, so releasing them would only let the gesture escape into the host app.
 *
 * A notch counts in document order rather than screen direction, so wheeling down always moves
 * further into the text whichever way the script runs.
 */
export default function useStripWheel({
  viewportRef,
  isRtl,
  onReaderTakeover,
}: UseStripWheelArgs): void {
  const onReaderTakeoverRef = useLatestRef(onReaderTakeover);

  const handleWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      // Ctrl+wheel and a trackpad pinch are the browser's zoom gesture, which reports as a wheel
      // event but asks to resize the text rather than to travel through it.
      if (event.ctrlKey) return;
      // A mouse reports the notch on the vertical axis and a trackpad swipe on the horizontal one;
      // over a horizontal strip both mean travel, so take whichever axis the gesture favors.
      const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const rawDelta = isHorizontal ? event.deltaX : event.deltaY;
      if (rawDelta === 0) return;
      // A vertical delta is document order already; only a horizontal one is screen direction and
      // has to turn around in an RTL strip. Document order from here down.
      const orientedDelta = isHorizontal && isRtl ? -rawDelta : rawDelta;
      // Pixels from here down, so the gain and the ceiling below need not care what the device
      // reported in.
      const delta = orientedDelta * wheelDeltaScale(event.deltaMode, viewportRef.current);
      // Claimed before the bounds below are known, so a notch spent at either end is consumed like
      // any other.
      event.preventDefault();
      const viewport = viewportRef.current;
      /* v8 ignore next -- the viewport is attached whenever a wheel reaches this handler */
      if (!viewport) return;
      // Clamped to what is mounted: the ceiling rises as the sentinels mount more groups, so a
      // scroll runs on mid-book and stops at the book's end. An RTL container counts offsets from
      // zero at the strip's start down through negatives, inverting both the range and the sign
      // that carries a document-order delta onward.
      const extent = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const minScroll = isRtl ? -extent : 0;
      const maxScroll = isRtl ? 0 : extent;
      const wanted = delta * WHEEL_SCROLL_GAIN * (isRtl ? -1 : 1);
      const travel = Math.sign(wanted) * Math.min(Math.abs(wanted), MAX_WHEEL_TRAVEL_PX);
      const before = viewport.scrollLeft;
      viewport.scrollLeft = Math.max(minScroll, Math.min(viewport.scrollLeft + travel, maxScroll));
      // Only a notch that moved the strip is the reader taking the scroll over. One spent at a
      // bound, or on a strip too short to scroll, leaves the position where centering put it, and
      // suspending centering for it would strand the focus against every later reflow.
      if (viewport.scrollLeft !== before) onReaderTakeoverRef.current();
    },
    [isRtl, viewportRef, onReaderTakeoverRef],
  );

  // Subscribed explicitly rather than through the JSX prop, which React attaches passively — and a
  // passive listener may not call `preventDefault`.
  useEffect(() => {
    const viewport = viewportRef.current;
    /* v8 ignore next -- the viewport is attached before effects run */
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [handleWheel, viewportRef]);
}
