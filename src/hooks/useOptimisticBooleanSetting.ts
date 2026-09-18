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
 * Reads a stored project setting as a boolean, or `undefined` when it carries no boolean value.
 *
 * Paratext persists the settings it owns as the strings `'True'` and `'False'` rather than as JSON
 * booleans, so a stored value arrives in either shape depending on which application last wrote it.
 * Taking only the boolean would silently substitute the default for every setting Paratext has
 * written, discarding the user's choice on the next render.
 */
function asBoolean(setting: unknown): boolean | undefined {
  if (typeof setting === 'boolean') return setting;
  if (setting === 'True') return true;
  if (setting === 'False') return false;
  return undefined;
}

/**
 * Manages a boolean project setting with optimistic UI updates, falling back to the given default
 * until the setting has been persisted for the first time.
 *
 * The local value is updated immediately on change and stays locked for {@link TIMEOUT_MS} to allow
 * the stored setting to finish updating without causing a visible bounce. While the lock is held,
 * platform updates are ignored; once it expires, they flow through normally.
 *
 * `isLoading` reports only that no value has been established yet, which a consumer gating its view
 * needs; it stays `false` through the write a change starts, since the displayed value is already
 * the chosen one and waiting on the store would hide a view that has nothing left to learn.
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

  const [value, setValue] = useState(asBoolean(setting) ?? defaultValue);
  /**
   * Whether the user has chosen a value through this hook, after which the displayed value is
   * theirs rather than anything the store has yet to report.
   */
  const [chosen, setChosen] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ignoreRef = useRef(false);

  useEffect(() => {
    // Ignore platform errors or settings that arrive during the timeout period.
    if (ignoreRef.current) return;
    const stored = asBoolean(setting);
    if (stored === undefined) return;

    setValue(stored);
  }, [setting]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onChange = useCallback(
    (newValue: boolean) => {
      setValue(newValue);
      setChosen(true);
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

  return { isLoading: isLoading && !chosen, onChange, value };
}
