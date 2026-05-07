import { useProjectSetting } from '@papi/frontend/react';
import { useCallback, useEffect, useRef, useState } from 'react';

/** A timeout duration longer than the 5-10 seconds it usually takes for a setting to save. */
const TIMEOUT_MS = 15_000;

/**
 * Manages a boolean project setting with optimistic UI updates.
 *
 * The local value is updated immediately on change and stays locked until timeout elapses, to allow
 * the stored setting to finish updating.
 *
 * @param projectId - PAPI project ID; pass `undefined` when outside a project context
 * @param settingKey - A valid key for a boolean setting
 * @param defaultValue - Default value used when the setting has not been persisted yet
 * @returns `value` — the current display value; `onChange` — stable change handler
 */
export default function useOptimisticBooleanSetting(
  projectId: string | undefined,
  settingKey: 'interlinearizer.continuousScroll',
  defaultValue: boolean,
): {
  value: boolean;
  onChange: (newValue: boolean) => void;
} {
  const [setting, setSetting] = useProjectSetting(projectId ?? '', settingKey, defaultValue);

  const [value, setValue] = useState(typeof setting === 'boolean' ? setting : defaultValue);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const ignoreRef = useRef(false);

  // Drive UI from optimistic local state and clear pending once the setting confirms.
  useEffect(() => {
    // Ignore platform errors or settings that arrive during the timeout period.
    if (ignoreRef.current || typeof setting !== 'boolean') return;

    setValue(setting);
  }, [setting]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onChange = useCallback(
    (newValue: boolean) => {
      setValue(newValue);
      ignoreRef.current = true;
      setSetting?.(newValue);
      // Reset the timeout on every call so back-to-back onChange calls don't let an earlier
      // timeout clear the pending value set by a later call.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        ignoreRef.current = false;
      }, TIMEOUT_MS);
    },
    [setSetting],
  );

  return { value, onChange };
}
