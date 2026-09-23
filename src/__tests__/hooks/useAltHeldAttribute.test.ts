/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { renderHook } from '@testing-library/react';
import { useAltHeldAttribute } from '../../hooks/useAltHeldAttribute';

const root = document.documentElement;

describe('useAltHeldAttribute', () => {
  afterEach(() => {
    root.removeAttribute('data-alt-held');
  });

  it('leaves the root unmarked before any key is pressed', () => {
    renderHook(() => useAltHeldAttribute());
    expect(root).not.toHaveAttribute('data-alt-held');
  });

  it('marks the root when Alt is pressed', () => {
    renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    expect(root).toHaveAttribute('data-alt-held');
  });

  it('unmarks the root on a keyup whose altKey flag is false', () => {
    renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { altKey: false }));
    expect(root).not.toHaveAttribute('data-alt-held');
  });

  it('unmarks the root on window blur', () => {
    renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    window.dispatchEvent(new Event('blur'));
    expect(root).not.toHaveAttribute('data-alt-held');
  });

  it('unmarks the root when the document visibility changes', () => {
    renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root).not.toHaveAttribute('data-alt-held');
  });

  it('does not rewrite the attribute on repeated keydowns while Alt stays held', () => {
    renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    const toggle = jest.spyOn(root, 'toggleAttribute');
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('unmarks the root on unmount', () => {
    const { unmount } = renderHook(() => useAltHeldAttribute());
    window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    unmount();
    expect(root).not.toHaveAttribute('data-alt-held');
  });
});
