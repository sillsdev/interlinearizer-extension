/** @file Unit tests for useOptimisticBooleanSetting hook. */
/// <reference types="jest" />

import { useProjectSetting } from '@papi/frontend/react';
import { act, renderHook } from '@testing-library/react';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';

/** Mock function for setting project settings. */
const mockSetSetting = jest.fn();

/**
 * Mocks useProjectSetting to return a specified default state.
 *
 * @param defaultState - The value to return as the current setting state.
 */
function mockUseProjectSettings(defaultState: boolean | undefined) {
  jest.mocked(useProjectSetting).mockReturnValue([defaultState, mockSetSetting, jest.fn(), false]);
}

const SETTING_KEY = 'interlinearizer.continuousScroll' as const;
const TIMEOUT_MS = 15_000;

describe('useOptimisticBooleanSetting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseProjectSettings(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the persisted setting value as the initial display value', () => {
    mockUseProjectSettings(true);
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    expect(result.current.value).toBe(true);
  });

  it('falls back to defaultValue when the persisted setting is not yet a boolean', () => {
    mockUseProjectSettings(undefined);
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );
    expect(result.current.value).toBe(true);
  });

  it('updates the display value immediately on change (optimistic update)', () => {
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    expect(result.current.value).toBe(true);
  });

  it('calls setSetting with the new value on change', () => {
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    expect(mockSetSetting).toHaveBeenCalledWith(true);
  });

  it('ignores incoming setting updates while the timeout is active', () => {
    // Setting not yet loaded so `setting` starts as non-boolean.
    mockUseProjectSettings(undefined);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );

    act(() => {
      result.current.onChange(false);
    });
    expect(result.current.value).toBe(false);

    // Simulate the store returning a conflicting value during the lock period.
    mockUseProjectSettings(true);
    rerender();

    // Value should remain at the optimistically set value.
    expect(result.current.value).toBe(false);
  });

  it('accepts incoming setting updates after the timeout elapses', () => {
    // Setting not yet loaded so `setting` starts as non-boolean.
    mockUseProjectSettings(undefined);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );

    // Make an optimistic change to `false` and let the store report a value during the lock.
    act(() => {
      result.current.onChange(false);
    });
    // Store reports `false` during the lock; the effect runs (setting changed
    // undefined -> false) but is ignored, so the display stays at the optimistic value.
    mockUseProjectSettings(false);
    rerender();
    expect(result.current.value).toBe(false); // Locked to optimistic value.

    // Fire the timeout — lock is released and incoming setting changes are accepted again.
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS);
    });

    // The store now reports `true`, which both differs from the prior `setting` (so the
    // effect re-runs) and from the current display value `false` (so acceptance is
    // observable). With the lock released, the display must follow the store to `true`.
    // If the timeout failed to release the lock, the effect early-returns and the
    // display would remain `false`, failing this assertion.
    mockUseProjectSettings(true);
    rerender();
    expect(result.current.value).toBe(true);
  });

  it('clears the first timeout when onChange is called a second time', () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );

    act(() => {
      result.current.onChange(true);
    });
    act(() => {
      result.current.onChange(false); // second call should clear the first timer
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('does not accept setting updates until the reset timeout elapses after back-to-back onChange calls', () => {
    // Start with a non-boolean setting so the initial useEffect bails early.
    mockUseProjectSettings(undefined);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );

    act(() => {
      result.current.onChange(true); // timer A starts at t=0
    });
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS - 1_000); // t=14000
    });
    act(() => {
      result.current.onChange(true); // timer A cleared, timer B starts at t=14000
    });

    // At t=15000, timer A would have fired but was cleared — lock still active.
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    // Arriving setting is ignored while locked. The store reports `true` here so that the
    // later post-lock value (`false`) both changes `setting` (re-running the effect) and
    // differs from the current display value (`true`), making acceptance observable.
    mockUseProjectSettings(true);
    rerender();
    expect(result.current.value).toBe(true); // locked; update blocked

    // Timer B fires at t=29000 — lock released.
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS - 1_000);
    });
    // The store now reports `false`, differing from both the prior `setting` (`true`) and
    // the current display value (`true`). With the lock released the display must follow
    // the store to `false`; if timer B failed to release the lock, the effect early-returns
    // and the display would remain `true`, failing this assertion.
    mockUseProjectSettings(false);
    rerender();
    expect(result.current.value).toBe(false); // lock released; setting accepted
  });

  it('clears the pending timeout on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
