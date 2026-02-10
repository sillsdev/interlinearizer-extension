/**
 * Jest mock for @papi/frontend/react. Provides stub implementations of all PAPI React hooks so
 * WebView/frontend components can be unit-tested without the real Platform API.
 *
 * Jest's moduleNameMapper in jest.config.ts maps '^@papi/frontend/react$' to this file.
 *
 * Exports match the real module (renderer/hooks/papi-hooks/index): useDataProvider, useData,
 * useScrollGroupScrRef, useSetting, useProjectData, useProjectDataProvider, useProjectSetting,
 * useDialogCallback, useDataProviderMulti, useLocalizedStrings, useWebViewController,
 * useRecentScriptureRefs. Each hook is a jest.fn() with a sensible default return so components
 * that use them do not throw; tests can override with mockReturnValue or mockImplementation.
 */

/** Default triple for [value, setValue, isLoading] returned by data hooks. */
const defaultDataHookReturn: [undefined, ReturnType<typeof jest.fn>, boolean] = [
  undefined,
  jest.fn(),
  false,
];

/**
 * useData('providerName') returns an object whose keys are data type names and values are hooks.
 * Mock: any property returns a function that returns [undefined, setter, false].
 */
const createUseDataLikeHook = () =>
  jest.fn(() =>
    new Proxy(
      {},
      {
        get: () => () => defaultDataHookReturn,
      },
    ),
  );

const useDataProvider = jest.fn().mockReturnValue(undefined);
const useData = createUseDataLikeHook();
const useScrollGroupScrRef = jest.fn().mockReturnValue([undefined, jest.fn()]);
const useSetting = jest.fn().mockImplementation((_key: string, defaultState: unknown) => [defaultState, jest.fn()]);
const useProjectData = createUseDataLikeHook();
const useProjectDataProvider = jest.fn().mockReturnValue(undefined);
const useProjectSetting = jest
  .fn()
  .mockImplementation((_projectInterface: string, _projectIdOrPdp: unknown, _key: string, defaultState: unknown) => [
    defaultState,
    jest.fn(),
  ]);
const useDialogCallback = jest.fn().mockReturnValue(jest.fn());
const useDataProviderMulti = jest.fn().mockReturnValue([]);
/** Returns a map of localization key -> key (so tests get a string for each key). */
const useLocalizedStrings = jest.fn().mockImplementation((keys: string[]) =>
  Array.isArray(keys) ? keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}) : {},
);
const useWebViewController = jest.fn().mockReturnValue(undefined);
const useRecentScriptureRefs = jest.fn().mockReturnValue([]);

module.exports = {
  __esModule: true,
  useDataProvider,
  useData,
  useScrollGroupScrRef,
  useSetting,
  useProjectData,
  useProjectDataProvider,
  useProjectSetting,
  useDialogCallback,
  useDataProviderMulti,
  useLocalizedStrings,
  useWebViewController,
  useRecentScriptureRefs,
  __mockUseDataProvider: useDataProvider,
  __mockUseData: useData,
  __mockUseLocalizedStrings: useLocalizedStrings,
  __mockUseSetting: useSetting,
  __mockUseProjectData: useProjectData,
  __mockUseProjectDataProvider: useProjectDataProvider,
  __mockUseProjectSetting: useProjectSetting,
  __mockUseWebViewController: useWebViewController,
};
