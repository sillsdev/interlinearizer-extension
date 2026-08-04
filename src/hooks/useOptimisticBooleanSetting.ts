import { useProjectSetting } from '@papi/frontend/react';
import type { ProjectSettingTypes } from 'papi-shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Keys in {@link ProjectSettingTypes} whose values are `boolean`. */
type BooleanProjectSettingKey = {
  [K in keyof ProjectSettingTypes]: ProjectSettingTypes[K] extends boolean ? K : never;
}[keyof ProjectSettingTypes];

/** A timeout duration longer than the 5-10 seconds it usually takes for a setting to save. */
const TIMEOUT_MS = 15_000;

/**
 * Manages a boolean project setting with optimistic UI updates, falling back to the given default
 * until the setting has been persisted for the first time.
 *
 * The local value is updated immediately on change and stays locked for {@link TIMEOUT_MS} to allow
 * the stored setting to finish updating without causing a visible bounce. While the lock is held,
 * platform updates are ignored; once it expires, they flow through normally.
 *
 * The change handler keeps a stable identity across renders, so consumers may pass it straight to a
 * memoized child.
 */
export default function useOptimisticBooleanSetting(
  projectId: string,
  settingKey: BooleanProjectSettingKey,
  defaultValue: boolean,
): {
  isLoading: boolean;
  onChange: (newValue: boolean) => void;
  value: boolean;
} {
  const [setting, setSetting, , isLoading] = useProjectSetting(projectId, settingKey, defaultValue);

  const [value, setValue] = useState(typeof setting === 'boolean' ? setting : defaultValue);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ignoreRef = useRef(false);

  useEffect(() => {
    // Ignore platform errors or settings that arrive during the timeout period.
    if (ignoreRef.current || typeof setting !== 'boolean') return;

    setValue(setting);
  }, [setting]);

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

  return { isLoading, onChange, value };
}
