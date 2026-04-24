/**
 * @file Jest mock for @papi/frontend/react. Provides stub implementations of various PAPI React hooks so
 * WebView/frontend components can be unit-tested without the real Platform API.
 */

/**
 * useData('providerName') returns an object whose keys are data type names and values are hooks.
 * Mock: any property returns a function that returns [undefined, setter, false].
 */
const createUseDataLikeHook = () =>
  jest.fn(() =>
    new Proxy(
      {},
      {
        get: () => () => [undefined, jest.fn(), false],
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
  .mockImplementation((_projectDataProviderSource: unknown, _key: string, defaultState: unknown) => [
    defaultState,
    jest.fn(),
    jest.fn(),
    false,
  ]);
const useDialogCallback = jest.fn().mockReturnValue(jest.fn());
const useDataProviderMulti = jest.fn().mockReturnValue([]);
/** Returns [record, isLoading] tuple; maps each key to itself so tests get a predictable string. */
const useLocalizedStrings = jest.fn().mockImplementation((keys: string[]) => [
  Array.isArray(keys) ? keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}) : {},
  false,
]);
const useWebViewController = jest.fn().mockReturnValue(undefined);
/** Returns { recentScriptureRefs, addRecentScriptureRef } matching the real hook signature. */
const useRecentScriptureRefs = jest
  .fn()
  .mockReturnValue({ recentScriptureRefs: [], addRecentScriptureRef: jest.fn() });

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
