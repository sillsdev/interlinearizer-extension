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
 *
 * @returns `true` while Alt is held, `false` otherwise.
 */
export function useAltHeld(): boolean {
  const [altHeld, setAltHeld] = useState(false);

  // Mirror of the current held state, read synchronously in the event handlers so a repeated
  // keydown (Alt auto-repeats while held) can short-circuit before ever calling the state setter —
  // avoiding the extra render React schedules even when a functional updater returns the same
  // value.
  const altHeldRef = useRef(false);

  useEffect(() => {
    /**
     * Sets the held state to `next` only when it differs from the current value, so the repeated
     * `keydown` events fired while Alt is held do not trigger a re-render each frame.
     *
     * @param next - The desired held state.
     */
    const set = (next: boolean) => {
      if (altHeldRef.current === next) return;
      altHeldRef.current = next;
      setAltHeld(next);
    };

    /**
     * Updates the held state from a keyboard event's `altKey` flag.
     *
     * @param event - The keyboard event whose `altKey` is read.
     */
    const onKey = (event: KeyboardEvent) => set(event.altKey);

    /** Clears the held state when focus leaves or the document is hidden. */
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
