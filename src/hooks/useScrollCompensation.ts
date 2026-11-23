import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

/** Arguments for {@link useScrollCompensation}. */
export interface UseScrollCompensationArgs {
  /** Ref to the scrolling list container. */
  scrollContainerRef: RefObject<HTMLElement | undefined>;
  /**
   * The element wrapping the mounted segments, `undefined` before it mounts. Its box is the one
   * that changes when segment heights settle; the container's own box is fixed by the panel
   * layout.
   */
  contentEl: HTMLElement | undefined;
  /** Bumped once per recenter, re-seeding the anchor against the new geometry. */
  recenterEpoch: number;
  /** `true` while a recenter owns the scroll position, when resizes are relayed instead. */
  recenterInFlightRef: RefObject<boolean>;
  /** Re-snaps the recentered verse; called on each resize while a recenter is in flight. */
  relayResize: () => void;
}

/**
 * Keeps the visible segments still while segments above the viewport change height, as arc padding
 * does when it settles across several frames after a segment mounts. Without it, that settling
 * would shove what the reader is looking at.
 *
 * One `ResizeObserver` plays two roles. While a recenter is in flight it relays each resize to
 * `relayResize`, which pins the recentered verse through every settling wave. Otherwise it restores
 * an anchor segment to the offset it last held below the container's top edge. Offsets are
 * container-relative, so the container itself moving or resizing (the strip mounting above it, a
 * panel resize) never reads as a content shift.
 *
 * The anchor is re-measured on every scroll, so scrolling is never misread as a height change to
 * correct.
 *
 * @returns A stable callback that re-picks and re-measures the anchor, for a caller that moved the
 *   content itself (an extend correction) to call afterwards.
 */
export default function useScrollCompensation({
  scrollContainerRef,
  contentEl,
  recenterEpoch,
  recenterInFlightRef,
  relayResize,
}: UseScrollCompensationArgs): () => void {
  /**
   * The topmost mounted segment intersecting the viewport, with its last-known offset below the
   * container's top edge. A visible segment rather than the top sentinel, because the sentinel sits
   * at the very top of the content: its offset moves only when `scrollTop` does, so it is blind to
   * the height changes between it and the viewport that compensation exists to catch.
   */
  const anchorRef = useRef<{ el: Element; offset: number } | undefined>(undefined);

  /**
   * Re-picks and re-measures the anchor: the first mounted segment whose bottom edge sits below the
   * container's top edge. Clears it when no mounted segment reaches the viewport.
   */
  const rebaseline = useCallback(() => {
    const root = scrollContainerRef.current;
    /* v8 ignore next -- callers only run while the window (and so the container) is mounted */
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const els = root.querySelectorAll('[data-segment-id]');
    const reaches = (el: Element) => el.getBoundingClientRect().bottom > rootTop;
    const record = (el: Element) => {
      anchorRef.current = {
        el,
        offset: el.getBoundingClientRect().top - rootTop,
      };
    };

    // Segments are stacked in document order, so "reaches the viewport" is false for a prefix of
    // the run and true from the anchor on. The search therefore resumes from the previous anchor
    // and steps to the new one, rather than re-reading the segments above it.
    const previous = anchorRef.current?.el;
    const from = previous === undefined ? -1 : Array.prototype.indexOf.call(els, previous);
    if (from !== -1) {
      if (reaches(els[from])) {
        let i = from;
        while (i > 0 && reaches(els[i - 1])) i -= 1;
        record(els[i]);
      } else {
        let i = from + 1;
        while (i < els.length && !reaches(els[i])) i += 1;
        if (i < els.length) record(els[i]);
        else anchorRef.current = undefined;
      }
      return;
    }

    for (let i = 0; i < els.length; i += 1) {
      if (reaches(els[i])) {
        record(els[i]);
        return;
      }
    }
    anchorRef.current = undefined;
  }, [scrollContainerRef]);

  // Observes both the segment wrapper, whose box changes when segment heights settle, and the
  // container, whose box changes on panel and strip resizes (waves the in-flight relay must see).
  // Stands down, re-baselining only, when the list is at the very top (growth at the book top needs
  // no correction) and when the anchor is missing or was unmounted. Re-subscribes on each recenter
  // so the anchor is re-seeded for the new geometry.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !contentEl) return undefined;
    const observer = new ResizeObserver(() => {
      if (recenterInFlightRef.current) {
        relayResize();
        return;
      }
      const anchor = anchorRef.current;
      if (!anchor || !anchor.el.isConnected || root.scrollTop === 0) {
        rebaseline();
        return;
      }
      const offset = anchor.el.getBoundingClientRect().top - root.getBoundingClientRect().top;
      // Content growing above the viewport pushes the anchor down; scrolling down by the same amount
      // holds the visible content fixed. Symmetric for shrink.
      const delta = offset - anchor.offset;
      if (delta !== 0) root.scrollTop += delta;
      rebaseline();
    });
    observer.observe(root);
    observer.observe(contentEl);
    // Re-picking the anchor walks the mounted rects, forcing a layout the scroll would otherwise
    // pay per event. A frame's worth of events collapses into one walk, which still lands before
    // the resize wave that reads the baseline.
    let rebaselineFrame: number | undefined;
    const handleScroll = () => {
      if (rebaselineFrame !== undefined) return;
      rebaselineFrame = requestAnimationFrame(() => {
        rebaselineFrame = undefined;
        rebaseline();
      });
    };
    root.addEventListener('scroll', handleScroll, { passive: true });
    rebaseline();
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', handleScroll);
      if (rebaselineFrame !== undefined) cancelAnimationFrame(rebaselineFrame);
    };
  }, [scrollContainerRef, contentEl, recenterEpoch, recenterInFlightRef, relayResize, rebaseline]);

  return rebaseline;
}
