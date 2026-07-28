import { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether the Alt key is currently held down, for the split-gap markers that reveal only
 * while Alt is pressed.
 *
 * State flips only on transitions (holding Alt fires repeated `keydown`s, so this avoids churn) and
 * is reset to `false` whenever focus could leave the WebView with Alt still logically down —
 * `window` `blur` and `document` `visibilitychange` to hidden — which is the common "stuck Alt"
 * failure mode after Alt+Tab out of the iframe. A `keyup` reading `altKey === false` likewise
 * clears it.
 */
export function useAltHeld(): boolean {
  const [altHeld, setAltHeld] = useState(false);

  // Mirror of the held state, read synchronously in the handlers so a repeated keydown (Alt
  // auto-repeats while held) short-circuits before calling the setter — avoiding the extra render
  // React schedules even when a functional updater returns the same value.
  const altHeldRef = useRef(false);

  useEffect(() => {
    const set = (next: boolean) => {
      if (altHeldRef.current === next) return;
      altHeldRef.current = next;
      setAltHeld(next);
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
    };
  }, []);

  return altHeld;
}
