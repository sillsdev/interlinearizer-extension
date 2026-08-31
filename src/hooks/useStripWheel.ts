import { useCallback, useEffect, useRef, type RefObject } from 'react';
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
 * Wheel travel (px) one focus step costs. Set to what a mouse notch reports, so a notch buys
 * exactly one step while a trackpad swipe — dozens of small deltas — has to accumulate to earn each
 * one, rather than racing the focus the length of the strip.
 */
export const WHEEL_STEP_THRESHOLD_PX = 100;

/**
 * Pixels a line-mode wheel delta stands for, as Firefox and some Linux configurations report a
 * notch as three lines. Sized against what a notch is worth rather than a line of text, which would
 * be smaller and cost those readers several notches per step.
 */
const WHEEL_LINE_HEIGHT_PX = WHEEL_STEP_THRESHOLD_PX / 3;

/**
 * Most travel (px) any one wheel event contributes toward a focus step — the stepping counterpart
 * to {@link MAX_WHEEL_TRAVEL_PX}. Equal to {@link WHEEL_STEP_THRESHOLD_PX}, so a capped event spends
 * its whole contribution on one step: a coalesced flick buys one step, not a burst.
 */
export const MAX_WHEEL_STEP_CONTRIBUTION_PX = WHEEL_STEP_THRESHOLD_PX;

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
  /** Ref to the clipping viewport the wheel is listened on and, in free-scroll mode, scrolled. */
  viewportRef: RefObject<HTMLElement | null>;
  /** Whether a notch scrolls the strip freely rather than stepping the focus one phrase. */
  freeScrollStrip: boolean;
  /** Whether the strip runs right-to-left, which inverts both its scroll range and a swipe's sense. */
  isRtl: boolean;
  /**
   * Moves the focus by a number of phrases, counted in document order so a positive move goes
   * further into the text. Only called in stepping mode.
   */
  step: (delta: number) => void;
  /**
   * Whether a step must be refused because the position it would count from is not the one the
   * reader can see. Consulted at event time, so raising or lowering it never re-subscribes the
   * wheel.
   */
  isStepBlockedRef: RefObject<boolean>;
  /**
   * Called when a gesture takes the scroll position away from whatever was placing it. The hook
   * decides when that has happened; the caller decides what it means for its own centering.
   */
  onReaderTakeover: () => void;
}

/**
 * Gives the continuous strip its wheel: a notch delivered over it travels the text, so a wheel
 * behaves there the way it does over any other scrollable region. Under free scrolling a notch
 * scrolls the strip and leaves the focus alone; otherwise it steps the focus one phrase and the
 * strip follows.
 *
 * Every notch over the strip is claimed, including one that moves nothing — spent at a bound, on a
 * strip too short to scroll, or on an event that only banks travel toward a later step. Nothing
 * above the strip would scroll to receive an unclaimed one anyway, so releasing them would only let
 * the gesture escape into the host app.
 *
 * A notch counts in document order rather than screen direction, so wheeling down always moves
 * further into the text whichever way the script runs.
 */
export default function useStripWheel({
  viewportRef,
  freeScrollStrip,
  isRtl,
  step,
  isStepBlockedRef,
  onReaderTakeover,
}: UseStripWheelArgs): void {
  /**
   * Wheel travel (px, document order) banked toward the next focus step but not yet spent. There is
   * no gesture-end decay, so travel short of a step outlives the gesture that banked it — bounded
   * below one step, costing at most one early step in the direction already being travelled.
   */
  const travelRef = useRef(0);

  // What a wheel notch does changes with the setting, so travel banked under one meaning must not
  // be spent under the other.
  useEffect(() => {
    travelRef.current = 0;
  }, [freeScrollStrip]);

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
      // Pixels from here down, so the gain and the ceilings below need not care what the device
      // reported in.
      const delta = orientedDelta * wheelDeltaScale(event.deltaMode, viewportRef.current);
      if (freeScrollStrip) {
        // Claimed before the bounds below are known, so a notch spent at either end is consumed
        // like any other.
        event.preventDefault();
        onReaderTakeoverRef.current();
        const viewport = viewportRef.current;
        if (viewport) {
          // Clamped to what is mounted: the ceiling rises as the sentinels mount more groups, so a
          // scroll runs on mid-book and stops at the book's end. An RTL container counts offsets
          // from zero at the strip's start down through negatives, inverting both the range and the
          // sign that carries a document-order delta onward.
          const extent = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
          const minScroll = isRtl ? -extent : 0;
          const maxScroll = isRtl ? 0 : extent;
          const wanted = delta * WHEEL_SCROLL_GAIN * (isRtl ? -1 : 1);
          const travel = Math.sign(wanted) * Math.min(Math.abs(wanted), MAX_WHEEL_TRAVEL_PX);
          viewport.scrollLeft = Math.max(
            minScroll,
            Math.min(viewport.scrollLeft + travel, maxScroll),
          );
        }
        return;
      }
      // Returning before the bank leaves this travel unaccumulated, so notches spent while blocked
      // do not add up to a step that fires the moment the block lifts.
      if (isStepBlockedRef.current) return;
      event.preventDefault();
      // A reversal spends nothing it banked going the other way, so a flick back starts from rest
      // instead of first burning off stale travel.
      const banked = Math.sign(travelRef.current) === Math.sign(delta) ? travelRef.current : 0;
      // Bounded on the way in rather than on what a step leaves behind: capping the remainder still
      // banks nearly a full step, which the next small notch tops up into another one.
      const contribution =
        Math.sign(delta) * Math.min(Math.abs(delta), MAX_WHEEL_STEP_CONTRIBUTION_PX);
      const travel = banked + contribution;
      if (Math.abs(travel) < WHEEL_STEP_THRESHOLD_PX) {
        travelRef.current = travel;
        return;
      }
      // One step per event however far it travelled, with the remainder left banked so a sustained
      // swipe keeps a steady pace rather than restarting from rest each time.
      travelRef.current = travel - Math.sign(travel) * WHEEL_STEP_THRESHOLD_PX;
      step(travel > 0 ? 1 : -1);
    },
    [step, isStepBlockedRef, freeScrollStrip, isRtl, viewportRef, onReaderTakeoverRef],
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
