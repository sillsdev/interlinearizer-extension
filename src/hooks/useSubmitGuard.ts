/** @file Hook that guards an async submit handler against re-entrant (double-click) invocation. */
import { useCallback, useRef, useState } from 'react';

/** Return value of {@link useSubmitGuard}. */
export type UseSubmitGuardResult = {
  /** True while a guarded call is in flight; wire to the submit controls' `disabled`. */
  isSubmitting: boolean;
  /**
   * Runs `fn` unless a prior guarded call is still in flight, in which case the call is ignored.
   * Flips {@link isSubmitting} for the duration of `fn` and always clears it afterward.
   *
   * @param fn - The async submit work to run.
   * @returns A promise that resolves once `fn` settles (or immediately when the call is ignored).
   */
  runGuarded: (fn: () => Promise<void>) => Promise<void>;
};

/**
 * Guards an async submit handler against re-entrant invocation (a double-click, or a programmatic
 * second call before the re-render that disables the control lands). A ref mirror short-circuits
 * the second call synchronously; the state drives the disabled UI. Factors out the `isSubmitting` +
 * `isSubmittingRef` + try/finally pattern the Save As and metadata modals each repeated for every
 * submit handler.
 *
 * @returns The in-flight flag and a `runGuarded` wrapper for submit handlers.
 */
export default function useSubmitGuard(): UseSubmitGuardResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Ref mirror of `isSubmitting` so a second invocation short-circuits synchronously, before the
  // re-render that disables the control lands (guards programmatic races).
  const isSubmittingRef = useRef(false);

  const runGuarded = useCallback(async (fn: () => Promise<void>) => {
    /* v8 ignore next -- controls are disabled while submitting; ref guards against programmatic races */
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await fn();
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, runGuarded };
}
