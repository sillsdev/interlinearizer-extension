import { useEffect } from 'react';

/**
 * Marks the document root with `data-alt-held` while the Alt key is held, driving the `alt-held:`
 * Tailwind variant. The mark clears whenever focus could leave the WebView with Alt still down, so
 * an Alt+Tab out of the iframe cannot leave it stuck.
 */
export function useAltHeldAttribute(): void {
  useEffect(() => {
    const root = document.documentElement;
    let held = false;
    const set = (next: boolean) => {
      // Alt auto-repeats `keydown` while held; skip the redundant attribute writes.
      if (held === next) return;
      held = next;
      root.toggleAttribute('data-alt-held', next);
    };

    const onKey = (event: KeyboardEvent) => set(event.altKey);

    const clear = () => set(false);

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      root.removeAttribute('data-alt-held');
    };
  }, []);
}
