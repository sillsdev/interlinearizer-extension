/**
 * @file Jest mock for @papi/frontend/react. Provides stub implementations of PAPI React hooks so
 * WebView/frontend components can be unit-tested without the real Platform API.
 */

/**
 * Mock for `useProjectData`. Returns a `Proxy` whose property accesses each yield a function
 * returning `[undefined, jest.fn(), false]`, matching the real hook's `[data, setter, isLoading]`
 * tuple without requiring a live data provider.
 */
const useProjectData = jest.fn(() =>
  new Proxy(
    {},
    {
      get: () => () => [undefined, jest.fn(), false],
    },
  ),
);

/**
 * Mock for `useProjectSetting`. Returns `[defaultState, setSetting, resetSetting, isLoading]`,
 * passing `defaultState` through unchanged so callers receive a predictable initial value.
 *
 * @param _projectDataProviderSource - Ignored project data provider source.
 * @param _key - Ignored setting key.
 * @param defaultState - Value surfaced as the current setting state.
 * @returns Tuple of `[defaultState, jest.fn(), jest.fn(), false]`.
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
 * Mock for `useLocalizedStrings`. Maps each requested key to itself so tests receive a
 * predictable `Record<string, string>` without a real localization service.
 *
 * @param keys - BCP47-style string keys to resolve.
 * @returns Tuple of `[record, isLoading]` where every key maps to itself and `isLoading` is
 *   `false`.
 */
const useLocalizedStrings = jest.fn().mockImplementation((keys: string[]) => [
  Array.isArray(keys) ? keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}) : {},
  false,
]);

/**
 * Mock for `useRecentScriptureRefs`. Returns an empty history and a no-op `addRecentScriptureRef`
 * so components that display recent references render without errors.
 *
 * @returns Object with `recentScriptureRefs` (empty array) and `addRecentScriptureRef` (jest spy).
 */
const useRecentScriptureRefs = jest
  .fn()
  .mockReturnValue({ recentScriptureRefs: [], addRecentScriptureRef: jest.fn() });

module.exports = {
  __esModule: true,
  useProjectData,
  useProjectSetting,
  useLocalizedStrings,
  useRecentScriptureRefs,
};

/** Marks this file as a module so top-level const/let are module-scoped. */
export {};
