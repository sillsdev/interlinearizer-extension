import { useProjectSetting } from '@papi/frontend/react';
import type { ProjectSettingTypes } from 'papi-shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keys in {@link ProjectSettingTypes} whose values are `boolean`, or `'auto'` until the user first
 * sets them.
 */
type BooleanProjectSettingKey = {
  [K in keyof ProjectSettingTypes]: ProjectSettingTypes[K] extends boolean | 'auto' ? K : never;
}[keyof ProjectSettingTypes];

/** A timeout duration longer than the 5-10 seconds it usually takes for a setting to save. */
const TIMEOUT_MS = 15_000;

/**
 * Reads a stored project setting as a boolean or the `'auto'` an unset one holds, or `undefined`
 * when it carries neither, as a platform error does.
 *
 * Paratext persists the settings it owns as the strings `'True'` and `'False'` rather than as JSON
 * booleans, so a stored value arrives in either shape depending on which application last wrote it.
 * Taking only the boolean would silently substitute the default for every setting Paratext has
 * written, discarding the user's choice on the next render.
 */
function readSetting(setting: unknown): boolean | 'auto' | undefined {
  if (typeof setting === 'boolean' || setting === 'auto') return setting;
  if (setting === 'True') return true;
  if (setting === 'False') return false;
  return undefined;
}

/**
 * Manages a boolean project setting with optimistic UI updates, falling back to `defaultValue`,
 * which may change after the setting loads, while the setting holds `'auto'` or has yet to report a
 * boolean.
 *
 * A change takes effect immediately and holds against later platform updates, so a slow write
 * cannot revert the user's choice.
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
  // A setting still loading reports the default passed in, which is no choice of the user's.
  const stored = isLoading ? undefined : readSetting(setting);

  const [value, setValue] = useState(stored);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ignoreRef = useRef(false);
  /** The value the store has reported since the current change, if the lock held one back. */
  const storedRef = useRef(stored);

  useEffect(() => {
    if (stored === undefined) return;
    storedRef.current = stored;

    // Ignore platform errors or settings that arrive during the timeout period.
    if (ignoreRef.current) return;

    setValue(stored);
  }, [stored]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onChange = useCallback(
    (newValue: boolean) => {
      setValue(newValue);
      ignoreRef.current = true;
      // The pre-change value is not an update to adopt; readopting it would undo the user's choice.
      storedRef.current = undefined;
      setSetting?.(newValue);
      // Reset the timeout on every call so back-to-back onChange calls don't let an earlier
      // timeout clear the pending value set by a later call.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        ignoreRef.current = false;
        // A value held back by the lock arrives once, so nothing later would deliver it.
        if (storedRef.current !== undefined) setValue(storedRef.current);
      }, TIMEOUT_MS);
    },
    [setSetting],
  );

  return { isLoading, onChange, value: typeof value === 'boolean' ? value : defaultValue };
}
