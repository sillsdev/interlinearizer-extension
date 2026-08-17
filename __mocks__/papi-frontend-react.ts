/**
 * @file Jest mock for @papi/frontend/react. Provides stub implementations of PAPI React hooks so
 * WebView/frontend components can be unit-tested without the real Platform API.
 */

/**
 * Known data-provider method names exposed by this mock. Tests that call an unlisted method will
 * receive a descriptive error rather than silently returning `undefined`, which mirrors the real
 * PAPI behavior where requesting an unsupported provider key is a programmer error.
 */
const KNOWN_PROJECT_DATA_METHODS = new Set(['BookUSJ']);

/**
 * Mock for `useProjectData`. Returns an object whose known methods each return
 * `[undefined, jest.fn(), false]`, matching the real hook's `[data, setter, isLoading]` tuple.
 * Accessing an unknown method throws to catch misspelled provider keys in tests.
 */
const useProjectData = jest.fn(() =>
  new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'string' && KNOWN_PROJECT_DATA_METHODS.has(prop)) {
          return () => [undefined, jest.fn(), false];
        }
        throw new Error(
          `useProjectData mock: unknown method "${String(prop)}". Add it to KNOWN_PROJECT_DATA_METHODS if intentional.`,
        );
      },
    },
  ),
);

/**
 * Mock for `useProjectSetting`. Returns `[defaultState, jest.fn(), jest.fn(), false]`, passing
 * `defaultState` through unchanged so callers receive a predictable initial value and never a
 * loading state.
 */
const useProjectSetting = jest
  .fn()
  .mockImplementation((_projectDataProviderSource: unknown, _key: string, defaultState: unknown) => [
    defaultState,
    jest.fn(),
    jest.fn(),
    false,
  ]);

/**
 * Records already built, keyed by the requested key list, so a repeated call hands back the same
 * object. The real hook keeps resolved data in state and so is stable across an unchanged render;
 * rebuilding the record every call would defeat any memo keyed on it and make a render-count
 * assertion a measurement of this mock rather than of the component.
 */
const localizedStringRecords = new Map<string, Record<string, string>>();

/**
 * Mock for `useLocalizedStrings`. Maps each requested key to itself so tests receive a
 * predictable `Record<string, string>` without a real localization service.
 *
 * @returns Tuple of `[record, isLoading]` where every key maps to itself and `isLoading` is
 *   `false`.
 */
const useLocalizedStrings = jest.fn().mockImplementation((keys: string[]) => {
  if (!Array.isArray(keys)) return [{}, false];
  const cacheKey = keys.join(' ');
  let record = localizedStringRecords.get(cacheKey);
  if (!record) {
    record = keys.reduce<Record<string, string>>((acc, k) => {
      acc[k] = k;
      return acc;
    }, {});
    localizedStringRecords.set(cacheKey, record);
  }
  return [record, false];
});

/**
 * Mock for `useSetting`. Returns `[defaultState, jest.fn(), jest.fn(), false]`, passing
 * `defaultState` through unchanged so callers receive a predictable initial value and never a
 * loading state.
 */
const useSetting = jest
  .fn()
  .mockImplementation((_key: string, defaultState: unknown) => [
    defaultState,
    jest.fn(),
    jest.fn(),
    false,
  ]);

/**
 * Mock for `useRecentScriptureRefs`. Returns an empty history and a no-op `addRecentScriptureRef`
 * so components that display recent references render without errors.
 */
const useRecentScriptureRefs = jest
  .fn()
  .mockImplementation(() => ({ recentScriptureRefs: [], addRecentScriptureRef: jest.fn() }));

/**
 * Mock for `useData`. Returns a `Proxy` whose property accesses each yield a function returning
 * `[undefined, jest.fn(), false]`, matching the real hook's `[data, setter, isLoading]` tuple
 * without requiring a live data provider.
 */
const useData = jest.fn(() =>
  new Proxy(
    {},
    {
      get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]),
    },
  ),
);

module.exports = {
  __esModule: true,
  useProjectData,
  useProjectSetting,
  useSetting,
  useLocalizedStrings,
  useRecentScriptureRefs,
  useData,
};

/** Marks this file as a module so top-level const/let are module-scoped. */
export {};
