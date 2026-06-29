/** @file Unit tests for components/InterlinearNavContext.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  INTERNAL_NAV_TTL_MS,
  InterlinearNavProvider,
  useInterlinearNav,
} from '../../components/InterlinearNavContext';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import { makeScrollGroupHook, type ScrollGroupTuple } from '../test-helpers';

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

  it('passes a chapter-level (verse 0) reference through to liveScrRef unchanged', () => {
    // Verse 0 is a real verse (a Psalm superscription), so it is no longer mapped to verse 1 here.
    // The loader resolves it to verse 1 only when the loaded book has no verse-0 segment.
    const ref: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 0 };
    const { result } = renderNav(makeScrollGroupHook(ref));

    expect(result.current.liveScrRef).toEqual(ref);
    expect(result.current.rawScrRef).toEqual(ref);
  });

  it('passes a same-chapter verse-0 reference through to liveScrRef (host < from verse 1)', () => {
    // Verse 0 is a real, focusable verse (a chapter superscription), so a verse-0 reference for the
    // chapter already shown passes through verbatim rather than being held on the current verse. This
    // is the host's `<` (previous-verse) from verse 1: it must land on the superscription, which the
    // loader resolves from verse 0 (or back to verse 1 when the chapter has no verse-0 segment).
    const { result, setRef, rerender } = renderNavMutable({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 1,
    });
    expect(result.current.liveScrRef).toEqual({ book: 'GEN', chapterNum: 3, verseNum: 1 });

    act(() => setRef({ book: 'GEN', chapterNum: 3, verseNum: 0 }));
    rerender();

    expect(result.current.liveScrRef).toEqual({ book: 'GEN', chapterNum: 3, verseNum: 0 });
  });

  it('passes a verse-0 reference for a different chapter through as a real chapter jump', () => {
    // A verse-0 reference for a chapter other than the one shown is a genuine chapter navigation, not
    // an echo, so it is honored as verse 0 (the loader maps it to verse 1 if that chapter has no
    // verse-0 segment).
    const { result, setRef, rerender } = renderNavMutable({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 7,
    });

    act(() => setRef({ book: 'GEN', chapterNum: 4, verseNum: 0 }));
    rerender();

    expect(result.current.liveScrRef).toEqual({ book: 'GEN', chapterNum: 4, verseNum: 0 });
  });

  describe('duplicate host deliveries', () => {
    it('keeps rawScrRef and liveScrRef identity when the host re-sends a value-equal reference', () => {
      // The scripture picker fires each external navigation twice in quick succession, the second
      // delivery being a fresh object with identical content. The provider must hand back the
      // previously adopted objects so the duplicate is invisible to consumers (no context-value
      // change, no re-render churn mid-recenter).
      const { result, setRef, rerender } = renderNavMutable({
        book: 'GEN',
        chapterNum: 3,
        verseNum: 7,
      });
      const rawBefore = result.current.rawScrRef;
      const liveBefore = result.current.liveScrRef;

      act(() => setRef({ book: 'GEN', chapterNum: 3, verseNum: 7 }));
      rerender();

      expect(result.current.rawScrRef).toBe(rawBefore);
      expect(result.current.liveScrRef).toBe(liveBefore);
    });

    it('treats a verse-0 chapter jump and its verse-1 form as two distinct deliveries', () => {
      // A chapter jump can arrive as a verse-0 reference followed by an explicit verse-1 reference.
      // Verse 0 and verse 1 are now distinct verses (verse 0 is the superscription), so the second
      // delivery is a genuine move to verse 1 rather than a deduped duplicate.
      const { result, setRef, rerender } = renderNavMutable({
        book: 'GEN',
        chapterNum: 3,
        verseNum: 7,
      });

      act(() => setRef({ book: 'GEN', chapterNum: 4, verseNum: 0 }));
      rerender();
      const liveAfterJump = result.current.liveScrRef;
      expect(liveAfterJump).toEqual({ book: 'GEN', chapterNum: 4, verseNum: 0 });

      act(() => setRef({ book: 'GEN', chapterNum: 4, verseNum: 1 }));
      rerender();

      expect(result.current.liveScrRef).toEqual({ book: 'GEN', chapterNum: 4, verseNum: 1 });
    });

    it('reuses the previous reference when a duplicate differs only in the verse segment string', () => {
      // The host fills the optional `verse` field inconsistently across its duplicate deliveries.
      // Nothing in the extension consumes it, so a delivery naming the same book/chapter/verse
      // must dedupe regardless.
      const initial: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 7, verse: '7' };
      const { result, setRef, rerender } = renderNavMutable(initial);

      act(() => setRef({ book: 'GEN', chapterNum: 3, verseNum: 7, verse: '7a' }));
      rerender();

      expect(result.current.rawScrRef).toBe(initial);
    });

    it('reuses the previous reference when a duplicate differs only in versification', () => {
      // Same rationale as the `verse` field: `versificationStr` arrives inconsistently on the
      // duplicate deliveries and is never consumed, so it must not defeat the dedup.
      const initial: SerializedVerseRef = {
        book: 'GEN',
        chapterNum: 3,
        verseNum: 7,
        versificationStr: 'English',
      };
      const { result, setRef, rerender } = renderNavMutable(initial);

      act(() =>
        setRef({ book: 'GEN', chapterNum: 3, verseNum: 7, versificationStr: 'Septuagint' }),
      );
      rerender();

      expect(result.current.rawScrRef).toBe(initial);
    });
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

    it('expires a stranded internal mark after the TTL so a later external navigation fades', () => {
      // When React batches two rapid internal clicks (verse A then B in one frame), the host
      // echoes only the final value: B's marker is consumed but A's is stranded. Once the TTL has
      // passed, a later external navigation to A must classify as external (consume returns
      // false), not be misread as internal by the stale marker.
      jest.useFakeTimers();
      try {
        const { result } = renderNav(
          makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
        );
        const a: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 5 };
        const b: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 10 };

        act(() => {
          result.current.navigate(a, 'internal');
          result.current.navigate(b, 'internal');
        });
        // The host coalesces the batched navigations and echoes only the final value.
        expect(result.current.consumeInternalNav(b)).toBe(true);

        jest.advanceTimersByTime(INTERNAL_NAV_TTL_MS + 1);
        expect(result.current.consumeInternalNav(a)).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keys a verse-0 internal mark to verse 0, distinct from verse 1', () => {
      // Verse 0 (a superscription) is its own verse, so a verse-0 internal navigation is consumable
      // only by a verse-0 reference — not by verse 1 of the same chapter.
      const { result } = renderNav(
        makeScrollGroupHook({ book: 'GEN', chapterNum: 1, verseNum: 1 }),
      );

      act(() => result.current.navigate({ book: 'GEN', chapterNum: 3, verseNum: 0 }, 'internal'));
      expect(result.current.consumeInternalNav({ book: 'GEN', chapterNum: 3, verseNum: 1 })).toBe(
        false,
      );

      act(() => result.current.navigate({ book: 'GEN', chapterNum: 3, verseNum: 0 }, 'internal'));
      expect(result.current.consumeInternalNav({ book: 'GEN', chapterNum: 3, verseNum: 0 })).toBe(
        true,
      );
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

    it('clears the stale fade-in timer when a second book change begins before idle', () => {
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      // First cross-book settle starts an in→idle timer (Timer A).
      act(() => setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // Advance partway through the timer, then trigger a second book change. The render-time
      // guard must clear Timer A so it cannot fire during the second fade-out.
      act(() => jest.advanceTimersByTime(100));
      act(() => setRef({ book: 'LUK', chapterNum: 2, verseNum: 1 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');

      // Advance past the point where Timer A would have fired — fadePhase must stay 'out'.
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('out');

      // The second settle starts a fresh timer and proceeds normally.
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('idle');
    });

    it('re-engages the curtain when an external navigation lands during the fade-in', () => {
      // The host resolves one picker selection as two navigations: the book change first, the
      // precise target a beat later — routinely landing while the reveal is still animating.
      // Re-engaging the curtain folds both into one cycle instead of fading the just-revealed
      // content a second time (the "double fade").
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'ZEP', chapterNum: 1, verseNum: 1 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // The precise target arrives mid-reveal: the curtain drops back to 'out'.
      act(() => setRef({ book: 'ZEP', chapterNum: 3, verseNum: 1 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');

      // The stale in→idle timer was cleared: advancing past it must not flip the phase.
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('out');

      // The re-anchored view settles: the curtain lifts once and the cycle completes.
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(result.current.fadePhase).toBe('idle');
    });

    it('does not re-engage the curtain for an internal navigation echoed back during the fade-in', () => {
      // A click made while the reveal is animating targets content already on screen; dropping the
      // curtain over it would hide the user's own selection.
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'ZEP', chapterNum: 1, verseNum: 1 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      act(() => result.current.navigate({ book: 'ZEP', chapterNum: 1, verseNum: 4 }, 'internal'));
      act(() => setRef({ book: 'ZEP', chapterNum: 1, verseNum: 4 }));
      rerender();

      expect(result.current.fadePhase).toBe('in');
    });

    it('re-engages the curtain when an expired stranded internal mark names the mid-reveal target', () => {
      // A stranded internal marker (its echo never arrived) must stop exempting the verse once the
      // TTL passes: a later external navigation to that verse landing mid-reveal still re-engages
      // the curtain. Markers stamp at navigate time and RECENTER_FADE_MS (500ms) is far shorter
      // than the TTL (3000ms), so the clock is advanced past the TTL *before* the reveal begins —
      // advancing during the 'in' phase would fire the fade-in timer to 'idle' first.
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      // Strand a marker for the eventual target: an internal navigation whose echo never arrives.
      act(() => result.current.navigate({ book: 'ZEP', chapterNum: 3, verseNum: 1 }, 'internal'));
      // Let the marker expire while the clock is still idle.
      act(() => jest.advanceTimersByTime(INTERNAL_NAV_TTL_MS + 1));

      // Cross-book navigation, then settle: the curtain is mid-reveal ('in').
      act(() => setRef({ book: 'ZEP', chapterNum: 1, verseNum: 1 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      // An external navigation to the stranded verse lands mid-reveal. The expired marker must not
      // exempt it: the curtain re-engages.
      act(() => setRef({ book: 'ZEP', chapterNum: 3, verseNum: 1 }));
      rerender();
      expect(result.current.fadePhase).toBe('out');
    });

    it('re-engages the curtain for a verse-0 navigation arriving during the fade-in', () => {
      // Verse 0 is an ordinary verse (a chapter superscription), so a verse-0 reference naming a
      // different verse than the one shown is a real mid-reveal navigation — e.g. the host's `<` from
      // verse 1 landing on the superscription. It re-engages the curtain like any other external move
      // arriving while the new book is still fading in, rather than fading the fresh content twice.
      const { result, rerender, setRef } = renderNavMutable({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      act(() => setRef({ book: 'ZEP', chapterNum: 3, verseNum: 5 }));
      rerender();
      act(() => result.current.reportSettled());
      expect(result.current.fadePhase).toBe('in');

      act(() => setRef({ book: 'ZEP', chapterNum: 3, verseNum: 0 }));
      rerender();

      expect(result.current.fadePhase).toBe('out');
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
