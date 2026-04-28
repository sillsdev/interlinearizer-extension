/**
 * @file Jest mock for @papi/frontend/react. Provides stub implementations of PAPI React hooks so
 * WebView/frontend components can be unit-tested without the real Platform API.
 */

const useProjectData = jest.fn(() =>
  new Proxy(
    {},
    {
      get: () => () => [undefined, jest.fn(), false],
    },
  ),
);

const useProjectSetting = jest
  .fn()
  .mockImplementation((_projectDataProviderSource: unknown, _key: string, defaultState: unknown) => [
    defaultState,
    jest.fn(),
    jest.fn(),
    false,
  ]);

/** Returns [record, isLoading] tuple; maps each key to itself so tests get a predictable string. */
const useLocalizedStrings = jest.fn().mockImplementation((keys: string[]) => [
  Array.isArray(keys) ? keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}) : {},
  false,
]);

/** Returns { recentScriptureRefs, addRecentScriptureRef } matching the real hook signature. */
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
