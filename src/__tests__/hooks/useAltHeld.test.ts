/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useAltHeld } from '../../hooks/useAltHeld';

describe('useAltHeld', () => {
  it('starts false before any key is pressed', () => {
    const { result } = renderHook(() => useAltHeld());
    expect(result.current).toBe(false);
  });

  it('becomes true when Alt is pressed', () => {
    const { result } = renderHook(() => useAltHeld());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    expect(result.current).toBe(true);
  });

  it('becomes false on a keyup whose altKey flag is false', () => {
    const { result } = renderHook(() => useAltHeld());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { altKey: false }));
    });
    expect(result.current).toBe(false);
  });

  it('resets to false on window blur', () => {
    const { result } = renderHook(() => useAltHeld());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBe(false);
  });

  it('resets to false when the document becomes hidden', () => {
    const { result } = renderHook(() => useAltHeld());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
  });

  it('does not re-render on repeated keydowns while Alt stays held', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useAltHeld();
    });
    const initialRenders = renders;
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    const rendersAfterFirstPress = renders;
    act(() => {
      // Holding Alt fires repeated keydowns; none of these should change state or re-render.
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    // The first press flipped the state (one extra render); the repeats add none.
    expect(rendersAfterFirstPress).toBe(initialRenders + 1);
    expect(renders).toBe(rendersAfterFirstPress);
  });
});
