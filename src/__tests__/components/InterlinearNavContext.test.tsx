/** @file Unit tests for components/InterlinearNavContext.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';

/** Tuple shape returned by the PAPI scroll-group hook. */
type ScrollGroupTuple = [
  SerializedVerseRef,
  (r: SerializedVerseRef) => void,
  number | undefined,
  (id: number | undefined) => void,
];

/**
 * Builds a `useWebViewScrollGroupScrRef` stub returning the given tuple parts. Defaults cover the
 * common case so a test only overrides what it asserts on.
 *
 * @param ref - The scripture reference the stub reports.
 * @param setScrRef - The reference setter; defaults to a noop.
 * @param scrollGroupId - The active scroll-group id; defaults to `undefined` (unlinked).
 * @param setScrollGroupId - The scroll-group setter; defaults to a noop.
 * @returns A hook returning the assembled tuple.
 */
function makeScrollGroupHook(
  ref: SerializedVerseRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
  scrollGroupId: number | undefined = undefined,
  setScrollGroupId: (id: number | undefined) => void = () => {},
) {
  return (): ScrollGroupTuple => [ref, setScrRef, scrollGroupId, setScrollGroupId];
}

/**
 * Renders {@link useInterlinearNav} inside a provider wired to the given scroll-group hook.
 *
 * @param hook - The `useWebViewScrollGroupScrRef` stub the provider should call.
 * @returns The render-hook result whose `current` is the nav surface.
 */
function renderNav(hook: () => ScrollGroupTuple) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InterlinearNavProvider useWebViewScrollGroupScrRef={hook}>{children}</InterlinearNavProvider>
  );
  return renderHook(() => useInterlinearNav(), { wrapper });
}

/**
 * Renders the nav hook with a scroll-group stub whose reference can be restaged between rerenders,
 * so a cross-book navigation can be simulated. A fresh object identity is required on each change
 * so the provider's `liveScrRef` memo recomputes.
 *
 * @param initial - The reference reported on the first render.
 * @returns The render-hook result plus a `setRef` to stage the next reference (call inside `act`,
 *   then `rerender`).
 */
function renderNavMutable(initial: SerializedVerseRef) {
  let current = initial;
  const hook = (): ScrollGroupTuple => [current, () => {}, undefined, () => {}];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InterlinearNavProvider useWebViewScrollGroupScrRef={hook}>{children}</InterlinearNavProvider>
  );
  const result = renderHook(() => useInterlinearNav(), { wrapper });
  return {
    ...result,
    setRef: (next: SerializedVerseRef) => {
      current = next;
    },
  };
}

describe('InterlinearNavContext', () => {
  it('exposes the raw reference and scroll-group plumbing verbatim', () => {
    const setScrRef = jest.fn();
    const setScrollGroupId = jest.fn();
    const ref: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 4 };
    const { result } = renderNav(makeScrollGroupHook(ref, setScrRef, 2, setScrollGroupId));

    expect(result.current.rawScrRef).toEqual(ref);
    expect(result.current.scrollGroupId).toBe(2);

    act(() => result.current.navigate({ book: 'MAT', chapterNum: 1, verseNum: 1 }));
    expect(setScrRef).toHaveBeenCalledWith({ book: 'MAT', chapterNum: 1, verseNum: 1 });

    act(() => result.current.setScrollGroupId(3));
    expect(setScrollGroupId).toHaveBeenCalledWith(3);
  });

  it('passes a verse-level reference through to liveScrRef unchanged', () => {
    const ref: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 4 };
    const { result } = renderNav(makeScrollGroupHook(ref));

    expect(result.current.liveScrRef).toEqual(ref);
  });

  it('normalizes a chapter-level (verse 0) reference to verse 1 in liveScrRef', () => {
    const ref: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 0 };
    const { result } = renderNav(makeScrollGroupHook(ref));

    expect(result.current.liveScrRef).toEqual({ book: 'GEN', chapterNum: 3, verseNum: 1 });
    // The raw reference still reports verse 0 so the editable nav controls reflect the selection.
    expect(result.current.rawScrRef).toEqual(ref);
  });

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useInterlinearNav())).toThrow(
      'useInterlinearNav must be used within an InterlinearNavProvider',
    );
  });

  describe('navigation origin classification', () => {
    it('marks an internal navigation as consumable exactly once', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
      const target: SerializedVerseRef = { book: 'MAT', chapterNum: 5, verseNum: 3 };

      act(() => result.current.navigate(target, 'internal'));
      // First consume matches and clears; a second consume of the same verse is now external.
      expect(result.current.consumeInternalNav(target)).toBe(true);
      expect(result.current.consumeInternalNav(target)).toBe(false);
    });

    it('does not mark an external (default) navigation as internal', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
      const target: SerializedVerseRef = { book: 'MAT', chapterNum: 5, verseNum: 3 };

      act(() => result.current.navigate(target));
      expect(result.current.consumeInternalNav(target)).toBe(false);
    });

    it('returns false when consuming a verse that was never marked internal', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
      expect(result.current.consumeInternalNav({ book: 'LUK', chapterNum: 2, verseNum: 1 })).toBe(
        false,
      );
    });

    it('keeps distinct internal marks for rapid successive internal navigations', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
      const a: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 5 };
      const b: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 9 };

      // Two internal navigations before either is consumed: both stay pending (set, not single slot).
      act(() => {
        result.current.navigate(a, 'internal');
        result.current.navigate(b, 'internal');
      });
      expect(result.current.consumeInternalNav(a)).toBe(true);
      expect(result.current.consumeInternalNav(b)).toBe(true);
    });
  });

  describe('cross-book fade clock', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('starts idle and does not fade on the initial load', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );
      expect(result.current.fadePhase).toBe('idle');
    });

    it('fades out on a book change, then in on reportSettled, then back to idle', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      expect(result.current.fadePhase).toBe('idle');

      // Cross-book navigation: the clock fades out and holds.
      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');

      // The view reports it has laid out the new book: fade back in.
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // After the fade-in duration the clock returns to idle.
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('idle');
    });

    it('does not fade for a same-book reference change', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'GEN', chapterNum: 5, verseNum: 10 }));
      rerender();
      expect(result.current.fadePhase).toBe('idle');
    });

    it('ignores reportSettled when no cross-book fade is awaiting it', () => {
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );

      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('idle');
    });

    it('reveals immediately via cancelFade, aborting an in-flight fade-out', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');

      act(() => result.current.cancelFade());
      expect(result.current.fadePhase).toBe('idle');

      // The fade was adopted as displayed, so a subsequent settle is a no-op (nothing awaiting).
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('idle');
    });

    it('cancelFade clears a pending fade-in timer so it cannot fire after reveal', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // Abort mid-fade-in: the pending in→idle timer is cleared and we settle to idle now.
      act(() => result.current.cancelFade());
      expect(result.current.fadePhase).toBe('idle');
      // Advancing past the original timer must not re-fire a stale transition.
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('idle');
    });

    it('supersedes a pending fade-in timer when a second book change settles before idle', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      // First cross-book settle leaves an in→idle timer pending.
      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // A second cross-book change + settle before the first timer fires must clear the prior timer
      // and start a fresh fade-in rather than letting the stale timer flip to idle early.
      act(() => setRef({ book: 'LUK', chapterNum: 2, verseNum: 1 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('idle');
    });

    it('clears the pending fade-in timer on unmount', () => {
      const { result, rerender, setRef, unmount } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      act(() => result.current.reportSettled());
      // Unmounting with the in→idle timer pending must not throw when the timer would have fired.
      unmount();
      expect(() => jest.advanceTimersByTime(RECENTER_FADE_MS)).not.toThrow();
    });
  });
});
