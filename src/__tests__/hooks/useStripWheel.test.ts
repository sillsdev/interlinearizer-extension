/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import useStripWheel, {
  MAX_WHEEL_TRAVEL_PX,
  WHEEL_STEP_THRESHOLD_PX,
  WHEEL_TRAVEL_IDLE_MS,
} from '../../hooks/useStripWheel';

/** What {@link renderStripWheel} hands back for driving and observing the subscribed viewport. */
type Wheel = {
  /** The element the hook listens on, attached to the document as it is in the strip. */
  viewport: HTMLElement;
  /** Every focus step the hook asked for, as a signed phrase count. */
  step: jest.Mock;
  /** Every time the hook reported the reader taking the scroll position over. */
  onReaderTakeover: jest.Mock;
  /** Raises or lowers the step gate, without the re-render that changing an argument would cause. */
  setStepBlocked: (blocked: boolean) => void;
  /** Re-renders under changed arguments, leaving the ones left out as they were. */
  update: (next?: Readonly<{ freeScrollStrip?: boolean; isRtl?: boolean }>) => void;
};

/**
 * Mounts the hook over a real, attached element, so a dispatched wheel event reaches it the way one
 * over the strip's viewport does.
 */
function renderStripWheel(
  options?: Readonly<{ freeScrollStrip?: boolean; isRtl?: boolean; isStepBlocked?: boolean }>,
): Wheel {
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  const step = jest.fn();
  const onReaderTakeover = jest.fn();
  const blockedRef = { current: options?.isStepBlocked ?? false };

  const { rerender } = renderHook(
    ({ freeScrollStrip, isRtl }: { freeScrollStrip: boolean; isRtl: boolean }) => {
      const viewportRef = useRef<HTMLElement | null>(viewport);
      useStripWheel({
        viewportRef,
        freeScrollStrip,
        isRtl,
        step,
        isStepBlockedRef: blockedRef,
        onReaderTakeover,
      });
    },
    {
      initialProps: {
        freeScrollStrip: options?.freeScrollStrip ?? false,
        isRtl: options?.isRtl ?? false,
      },
    },
  );

  let props = {
    freeScrollStrip: options?.freeScrollStrip ?? false,
    isRtl: options?.isRtl ?? false,
  };
  return {
    viewport,
    step,
    onReaderTakeover,
    setStepBlocked: (blocked) => {
      blockedRef.current = blocked;
    },
    update: (next) => {
      props = { ...props, ...next };
      rerender(props);
    },
  };
}

/**
 * Delivers a wheel gesture to the viewport, defaulting the axes the caller leaves out to no travel.
 *
 * @returns The dispatched event, cancelable so a test can read whether the hook claimed the
 *   gesture.
 */
function wheel(
  viewport: HTMLElement,
  init: Readonly<{ deltaY?: number; deltaX?: number; deltaMode?: number; ctrlKey?: boolean }>,
): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: 0,
    deltaX: 0,
    cancelable: true,
    ...init,
  });
  act(() => {
    viewport.dispatchEvent(event);
  });
  return event;
}

/**
 * Gives the viewport a scrollable extent, since jsdom lays nothing out and would otherwise report a
 * zero-width strip with nowhere to scroll.
 */
function stubScrollableExtent(viewport: HTMLElement, scrollWidth = 5000, clientWidth = 400): void {
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: clientWidth });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('useStripWheel stepping mode', () => {
  it('steps forward on a downward wheel notch', () => {
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 100 });

    expect(strip.step).toHaveBeenCalledWith(1);
  });

  it('steps backward on an upward wheel notch', () => {
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: -100 });

    expect(strip.step).toHaveBeenCalledWith(-1);
  });

  it('steps by the horizontal delta when it dominates the gesture', () => {
    // A trackpad swipe reports both axes; the strip travels by whichever the reader meant.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaX: -100, deltaY: 10 });

    expect(strip.step).toHaveBeenCalledWith(-1);
  });

  it('steps once for a burst of small deltas that together make one notch', () => {
    // A trackpad delivers one swipe as dozens of small events; stepping on each would race the
    // focus the length of the strip.
    const strip = renderStripWheel();

    for (let i = 0; i < 10; i += 1) {
      wheel(strip.viewport, { deltaY: 10 });
    }

    expect(strip.step).toHaveBeenCalledTimes(1);
  });

  it('takes no step from travel that has not yet reached a notch', () => {
    const strip = renderStripWheel();

    for (let i = 0; i < 9; i += 1) {
      wheel(strip.viewport, { deltaY: 10 });
    }

    expect(strip.step).not.toHaveBeenCalled();
  });

  it('keeps a sustained swipe stepping rather than restarting it each time', () => {
    // Twice the travel of one notch, so a bank that zeroed on each step would stall just short of
    // the second.
    const strip = renderStripWheel();

    for (let i = 0; i < 20; i += 1) {
      wheel(strip.viewport, { deltaY: 10 });
    }

    expect(strip.step).toHaveBeenCalledTimes(2);
  });

  it('steps only once for a coalesced event carrying a whole swipe', () => {
    // A compositor hands over everything it could not deliver in one event; spending all of that
    // travel at once would jump the focus clear across the strip.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 2382 });

    expect(strip.step).toHaveBeenCalledTimes(1);
  });

  it('buys one step with a line-mode notch, as a pixel-mode notch does', () => {
    // Firefox and some Linux setups report a notch as three lines rather than as pixels.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 3, deltaMode: 1 });

    expect(strip.step).toHaveBeenCalledWith(1);
  });

  it('spends no banked flick travel on the notches that follow it', () => {
    // A delta far past one step, then nudges far short of one: the surplus must not fund them.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 2382 });
    for (let i = 0; i < 5; i += 1) {
      wheel(strip.viewport, { deltaY: 10 });
    }

    expect(strip.step).toHaveBeenCalledTimes(1);
  });

  it('carries travel short of a step between the events of one swipe', () => {
    // Two deltas that each fall short of a step but together clear one, so a swipe that dropped
    // what it banked between events would stall instead of stepping.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 90 });
    wheel(strip.viewport, { deltaY: 90 });

    expect(strip.step).toHaveBeenCalledTimes(1);
  });

  it('drops travel banked short of a step once the gesture that banked it has gone quiet', () => {
    // A wheel reports no gesture end, so nothing but a pause marks one as over.
    jest.useFakeTimers();
    try {
      const strip = renderStripWheel();

      wheel(strip.viewport, { deltaY: 95 });
      act(() => {
        jest.advanceTimersByTime(WHEEL_TRAVEL_IDLE_MS);
      });
      wheel(strip.viewport, { deltaY: 10 });

      expect(strip.step).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps travel banked across the gaps within one sustained swipe', () => {
    // The expiry has to clear a swipe's own inter-event gap, or it breaks the accumulation it
    // exists to bound.
    jest.useFakeTimers();
    try {
      const strip = renderStripWheel();

      wheel(strip.viewport, { deltaY: 95 });
      act(() => {
        jest.advanceTimersByTime(WHEEL_TRAVEL_IDLE_MS - 1);
      });
      wheel(strip.viewport, { deltaY: 10 });

      expect(strip.step).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('starts a reversal from rest instead of spending travel banked the other way', () => {
    const strip = renderStripWheel();

    for (let i = 0; i < 9; i += 1) {
      wheel(strip.viewport, { deltaY: 10 });
    }
    wheel(strip.viewport, { deltaY: -10 });

    expect(strip.step).not.toHaveBeenCalled();
  });

  it('takes no step on a ctrl+wheel zoom gesture', () => {
    // A trackpad pinch reaches the handler as a wheel event carrying `ctrlKey`, not as a gesture
    // event of its own.
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaY: 100, ctrlKey: true });

    expect(strip.step).not.toHaveBeenCalled();
  });

  it('leaves a ctrl+wheel zoom gesture unclaimed', () => {
    // Claiming it would suppress the browser's own zoom, which is the whole gesture.
    const strip = renderStripWheel();

    const event = wheel(strip.viewport, { deltaY: 100, ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
  });

  it('claims a notch it banks toward a later step', () => {
    // The events that only bank travel are part of the same gesture as the one that spends it, so
    // letting them through would scroll an ancestor mid-swipe.
    const strip = renderStripWheel();

    const event = wheel(strip.viewport, { deltaY: 10 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('spends a notch that steps the focus rather than also scrolling the panel', () => {
    // Stepping a phrase and scrolling whatever ancestor scrolls, off one notch, is hard to aim.
    const strip = renderStripWheel();

    const event = wheel(strip.viewport, { deltaY: 100 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('takes no step when the wheel reports no travel on either axis', () => {
    const strip = renderStripWheel();

    wheel(strip.viewport, { deltaX: 0, deltaY: 0 });

    expect(strip.step).not.toHaveBeenCalled();
  });

  it('leaves a wheel reporting no travel unclaimed', () => {
    const strip = renderStripWheel();

    const event = wheel(strip.viewport, { deltaX: 0, deltaY: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  describe('while the step gate is raised', () => {
    it('takes no step', () => {
      const strip = renderStripWheel({ isStepBlocked: true });

      wheel(strip.viewport, { deltaY: 100 });

      expect(strip.step).not.toHaveBeenCalled();
    });

    it('leaves the notch it refuses to the browser', () => {
      // A notch the gate rejects steps nothing, so claiming it too would leave the gesture doing
      // nothing whatsoever.
      const strip = renderStripWheel({ isStepBlocked: true });

      const event = wheel(strip.viewport, { deltaY: 100 });

      expect(event.defaultPrevented).toBe(false);
    });

    it('banks no travel toward a step taken once the gate lifts', () => {
      // Accumulating while blocked would fire a step the moment the gate lifts, off notches the
      // reader spent when nothing was moving.
      const strip = renderStripWheel({ isStepBlocked: true });

      for (let i = 0; i < 9; i += 1) {
        wheel(strip.viewport, { deltaY: 10 });
      }
      strip.setStepBlocked(false);
      wheel(strip.viewport, { deltaY: 10 });

      expect(strip.step).not.toHaveBeenCalled();
    });

    it('steps again once the gate lifts', () => {
      const strip = renderStripWheel({ isStepBlocked: true });

      wheel(strip.viewport, { deltaY: 100 });
      strip.setStepBlocked(false);
      wheel(strip.viewport, { deltaY: 100 });

      expect(strip.step).toHaveBeenCalledTimes(1);
    });
  });

  describe('in an RTL strip', () => {
    it('steps forward on a leftward swipe, which is the way an RTL text runs on', () => {
      const strip = renderStripWheel({ isRtl: true });

      wheel(strip.viewport, { deltaX: -100 });

      expect(strip.step).toHaveBeenCalledWith(1);
    });

    it('steps backward on a rightward swipe', () => {
      const strip = renderStripWheel({ isRtl: true });

      wheel(strip.viewport, { deltaX: 100 });

      expect(strip.step).toHaveBeenCalledWith(-1);
    });

    it('reads a downward notch as forward, since a vertical delta is document order', () => {
      const strip = renderStripWheel({ isRtl: true });

      wheel(strip.viewport, { deltaY: 100 });

      expect(strip.step).toHaveBeenCalledWith(1);
    });
  });
});

describe('useStripWheel free-scroll mode', () => {
  it('takes no step on a wheel notch', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);

    wheel(strip.viewport, { deltaY: 100 });

    expect(strip.step).not.toHaveBeenCalled();
  });

  it('scrolls the viewport forward on a downward wheel notch', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 100 });

    expect(strip.viewport.scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls the viewport backward on an upward wheel notch', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaY: -100 });

    expect(strip.viewport.scrollLeft).toBeLessThan(500);
  });

  it('scrolls no further than the content once the book has run out', () => {
    // The ceiling has to hold against a single large delta, because the momentum after a trackpad
    // flick keeps delivering them well after the reader has let go.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 480;

    wheel(strip.viewport, { deltaY: 400 });

    expect(strip.viewport.scrollLeft).toBe(500);
  });

  it('scrolls no further back than the start of the content', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 20;

    wheel(strip.viewport, { deltaY: -400 });

    expect(strip.viewport.scrollLeft).toBe(0);
  });

  it('scrolls the strip nowhere on a ctrl+wheel zoom gesture', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 200;

    wheel(strip.viewport, { deltaY: 100, ctrlKey: true });

    expect(strip.viewport.scrollLeft).toBe(200);
  });

  it('travels less than the gesture, so a swipe does not carry the strip away', () => {
    // A strip is one line of text, so the travel a page absorbs unremarkably reads as a blur here.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 100 });

    expect(strip.viewport.scrollLeft).toBeGreaterThan(0);
    expect(strip.viewport.scrollLeft).toBeLessThan(100);
  });

  it('travels no further on one huge delta than the per-event ceiling allows', () => {
    // A compositor batches what it could not deliver, so one event can carry thousands of pixels —
    // and a finger that has already stopped moving still lands one. Uncapped, that single event
    // throws the strip more than a viewport, long after the reader stopped asking for travel.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 2382 });

    expect(strip.viewport.scrollLeft).toBe(MAX_WHEEL_TRAVEL_PX);
  });

  it('caps a huge backward delta by the same ceiling', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 3000;

    wheel(strip.viewport, { deltaY: -2382 });

    expect(strip.viewport.scrollLeft).toBe(3000 - MAX_WHEEL_TRAVEL_PX);
  });

  it('scrolls the viewport forward on a trackpad swipe toward the end of the text', () => {
    // In an LTR strip screen direction and document order agree, so a rightward swipe is the one
    // that travels onward.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaX: 100 });

    expect(strip.viewport.scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls the viewport backward on a trackpad swipe toward the start of the text', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaX: -100 });

    expect(strip.viewport.scrollLeft).toBeLessThan(500);
  });

  it('travels the same distance for a line-mode notch as for a pixel-mode one', () => {
    // Firefox and some Linux setups report a notch as three lines rather than as pixels.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 3, deltaMode: 1 });
    const lineModeTravel = strip.viewport.scrollLeft;
    strip.viewport.scrollLeft = 0;
    wheel(strip.viewport, { deltaY: WHEEL_STEP_THRESHOLD_PX });

    expect(lineModeTravel).toBe(strip.viewport.scrollLeft);
  });

  it('claims a notch it spends at a bound, which moves the strip nowhere', () => {
    // Releasing it would let a gesture the strip has fully absorbed escape into the host app.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 500;

    const event = wheel(strip.viewport, { deltaY: 300 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('reports a takeover once a notch has moved the strip', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).toHaveBeenCalled();
  });

  it('reports no takeover from a notch spent at the end of the scroll range', () => {
    // A notch the bounds absorb leaves the strip where centering put it, so it is no takeover.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).not.toHaveBeenCalled();
  });

  it('reports no takeover on a strip too short to scroll', () => {
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport, 400, 400);

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).not.toHaveBeenCalled();
  });

  it('banks no scroll travel toward a step taken after free scrolling is turned off', () => {
    // A notch means one thing under the setting and another without it, so travel banked under one
    // cannot be spent under the other.
    const strip = renderStripWheel({ freeScrollStrip: true });
    stubScrollableExtent(strip.viewport);
    wheel(strip.viewport, { deltaY: 90 });

    strip.update({ freeScrollStrip: false });
    wheel(strip.viewport, { deltaY: 90 });

    expect(strip.step).not.toHaveBeenCalled();
  });

  describe('in an RTL strip', () => {
    // jsdom does not model the negative scroll offsets an RTL container reports, so these assert
    // the arithmetic the handler applies rather than real scrolling.

    it('scrolls the viewport further into the text on a downward wheel notch', () => {
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = 0;

      wheel(strip.viewport, { deltaY: 100 });

      expect(strip.viewport.scrollLeft).toBeLessThan(0);
    });

    it('scrolls the viewport back toward the start on an upward wheel notch', () => {
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = -500;

      wheel(strip.viewport, { deltaY: -100 });

      expect(strip.viewport.scrollLeft).toBeGreaterThan(-500);
    });

    it('scrolls no further than the content once the book has run out', () => {
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport, 900, 400);
      strip.viewport.scrollLeft = -480;

      wheel(strip.viewport, { deltaY: 400 });

      expect(strip.viewport.scrollLeft).toBe(-500);
    });

    it('scrolls no further back than the start of the content', () => {
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport, 900, 400);
      strip.viewport.scrollLeft = -20;

      wheel(strip.viewport, { deltaY: -400 });

      expect(strip.viewport.scrollLeft).toBe(0);
    });

    it('scrolls the viewport further into the text on a leftward trackpad swipe', () => {
      // Here the axes part company: an RTL text runs on to the left, so the leftward swipe is the
      // one asking to go onward.
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = 0;

      wheel(strip.viewport, { deltaX: -100 });

      expect(strip.viewport.scrollLeft).toBeLessThan(0);
    });

    it('scrolls the viewport back toward the start on a rightward trackpad swipe', () => {
      const strip = renderStripWheel({ freeScrollStrip: true, isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = -500;

      wheel(strip.viewport, { deltaX: 100 });

      expect(strip.viewport.scrollLeft).toBeGreaterThan(-500);
    });
  });
});
