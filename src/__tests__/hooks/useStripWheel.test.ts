/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import useStripWheel, { MAX_WHEEL_TRAVEL_PX } from '../../hooks/useStripWheel';

/** What {@link renderStripWheel} hands back for driving and observing the subscribed viewport. */
type Wheel = {
  /** The element the hook listens on, attached to the document as it is in the strip. */
  viewport: HTMLElement;
  /** Every time the hook reported the reader taking the scroll position over. */
  onReaderTakeover: jest.Mock;
};

/**
 * Mounts the hook over a real, attached element, so a dispatched wheel event reaches it the way one
 * over the strip's viewport does.
 */
function renderStripWheel(options?: Readonly<{ isRtl?: boolean }>): Wheel {
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  const onReaderTakeover = jest.fn();

  renderHook(() => {
    const viewportRef = useRef<HTMLElement | null>(viewport);
    useStripWheel({ viewportRef, isRtl: options?.isRtl ?? false, onReaderTakeover });
  });

  return { viewport, onReaderTakeover };
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

describe('useStripWheel', () => {
  it('scrolls the viewport forward on a downward wheel notch', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 100 });

    expect(strip.viewport.scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls the viewport backward on an upward wheel notch', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaY: -100 });

    expect(strip.viewport.scrollLeft).toBeLessThan(500);
  });

  it('scrolls no further than the content once the book has run out', () => {
    // The ceiling has to hold against a single large delta, because the momentum after a trackpad
    // flick keeps delivering them well after the reader has let go.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 480;

    wheel(strip.viewport, { deltaY: 400 });

    expect(strip.viewport.scrollLeft).toBe(500);
  });

  it('scrolls no further back than the start of the content', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 20;

    wheel(strip.viewport, { deltaY: -400 });

    expect(strip.viewport.scrollLeft).toBe(0);
  });

  it('scrolls the strip nowhere on a ctrl+wheel zoom gesture', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 200;

    wheel(strip.viewport, { deltaY: 100, ctrlKey: true });

    expect(strip.viewport.scrollLeft).toBe(200);
  });

  it('leaves a ctrl+wheel zoom gesture unclaimed', () => {
    // A trackpad pinch reaches the handler as a wheel event carrying `ctrlKey`, and claiming it
    // would suppress the browser's own zoom, which is the whole gesture.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);

    const event = wheel(strip.viewport, { deltaY: 100, ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a wheel reporting no travel unclaimed', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);

    const event = wheel(strip.viewport, { deltaX: 0, deltaY: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('travels less than the gesture, so a swipe does not carry the strip away', () => {
    // A strip is one line of text, so the travel a page absorbs unremarkably reads as a blur here.
    const strip = renderStripWheel();
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
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 2382 });

    expect(strip.viewport.scrollLeft).toBe(MAX_WHEEL_TRAVEL_PX);
  });

  it('caps a huge backward delta by the same ceiling', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 3000;

    wheel(strip.viewport, { deltaY: -2382 });

    expect(strip.viewport.scrollLeft).toBe(3000 - MAX_WHEEL_TRAVEL_PX);
  });

  it('scrolls the viewport forward on a trackpad swipe toward the end of the text', () => {
    // In an LTR strip screen direction and document order agree, so a rightward swipe is the one
    // that travels onward.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaX: 100 });

    expect(strip.viewport.scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls the viewport backward on a trackpad swipe toward the start of the text', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaX: -100 });

    expect(strip.viewport.scrollLeft).toBeLessThan(500);
  });

  it('scrolls by the horizontal delta when it dominates the gesture', () => {
    // A trackpad swipe reports both axes; the strip travels by whichever the reader meant.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaX: -100, deltaY: 10 });

    expect(strip.viewport.scrollLeft).toBeLessThan(500);
  });

  it('travels the same distance for a line-mode notch as for a pixel-mode one', () => {
    // Firefox and some Linux setups report a notch as three lines rather than as 100 pixels.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 3, deltaMode: 1 });
    const lineModeTravel = strip.viewport.scrollLeft;
    strip.viewport.scrollLeft = 0;
    wheel(strip.viewport, { deltaY: 100 });

    expect(lineModeTravel).toBe(strip.viewport.scrollLeft);
  });

  it('claims a notch that scrolls the strip rather than also scrolling the panel', () => {
    // Scrolling the strip and whatever ancestor scrolls, off one notch, is hard to aim.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);

    const event = wheel(strip.viewport, { deltaY: 100 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('claims a notch it spends at a bound, which moves the strip nowhere', () => {
    // Releasing it would let a gesture the strip has fully absorbed escape into the host app.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 500;

    const event = wheel(strip.viewport, { deltaY: 300 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('reports a takeover once a notch has moved the strip', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport);
    strip.viewport.scrollLeft = 0;

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).toHaveBeenCalled();
  });

  it('reports no takeover from a notch spent at the end of the scroll range', () => {
    // A notch the bounds absorb leaves the strip where centering put it, so it is no takeover.
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport, 900, 400);
    strip.viewport.scrollLeft = 500;

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).not.toHaveBeenCalled();
  });

  it('reports no takeover on a strip too short to scroll', () => {
    const strip = renderStripWheel();
    stubScrollableExtent(strip.viewport, 400, 400);

    wheel(strip.viewport, { deltaY: 300 });

    expect(strip.onReaderTakeover).not.toHaveBeenCalled();
  });

  describe('in an RTL strip', () => {
    // jsdom does not model the negative scroll offsets an RTL container reports, so these assert
    // the arithmetic the handler applies rather than real scrolling.

    it('scrolls the viewport further into the text on a downward wheel notch', () => {
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = 0;

      wheel(strip.viewport, { deltaY: 100 });

      expect(strip.viewport.scrollLeft).toBeLessThan(0);
    });

    it('scrolls the viewport back toward the start on an upward wheel notch', () => {
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = -500;

      wheel(strip.viewport, { deltaY: -100 });

      expect(strip.viewport.scrollLeft).toBeGreaterThan(-500);
    });

    it('scrolls no further than the content once the book has run out', () => {
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport, 900, 400);
      strip.viewport.scrollLeft = -480;

      wheel(strip.viewport, { deltaY: 400 });

      expect(strip.viewport.scrollLeft).toBe(-500);
    });

    it('scrolls no further back than the start of the content', () => {
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport, 900, 400);
      strip.viewport.scrollLeft = -20;

      wheel(strip.viewport, { deltaY: -400 });

      expect(strip.viewport.scrollLeft).toBe(0);
    });

    it('scrolls the viewport further into the text on a leftward trackpad swipe', () => {
      // Here the axes part company: an RTL text runs on to the left, so the leftward swipe is the
      // one asking to go onward.
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = 0;

      wheel(strip.viewport, { deltaX: -100 });

      expect(strip.viewport.scrollLeft).toBeLessThan(0);
    });

    it('scrolls the viewport back toward the start on a rightward trackpad swipe', () => {
      const strip = renderStripWheel({ isRtl: true });
      stubScrollableExtent(strip.viewport);
      strip.viewport.scrollLeft = -500;

      wheel(strip.viewport, { deltaX: 100 });

      expect(strip.viewport.scrollLeft).toBeGreaterThan(-500);
    });
  });
});
