/**
 * Shared access to the manual `AnalysisStore` mock's read-only switch, for the several test files
 * that render components under `useAnalysisReadOnly`.
 *
 * This lives apart from `test-helpers` on purpose: that module imports the real
 * `AnalysisStoreProvider`, so in a file that mocks `AnalysisStore` its `withAnalysisStore` would
 * silently render the mock's provider instead.
 */

/** The manual AnalysisStore mock's test-only controls. */
interface AnalysisStoreReadOnlyMock {
  __setMockAnalysisReadOnly: (value: boolean) => void;
}

function isAnalysisStoreReadOnlyMock(m: unknown): m is AnalysisStoreReadOnlyMock {
  return !!m && typeof m === 'object' && '__setMockAnalysisReadOnly' in m;
}

/**
 * Sets what the mocked `useAnalysisReadOnly` returns. Resolves the mock on each call rather than at
 * import time, so importing this module never depends on `jest.mock` having run first.
 *
 * @param value Whether the mocked store reports the analysis as read-only.
 */
export function setMockAnalysisReadOnly(value: boolean): void {
  const analysisStoreMock: unknown = jest.requireMock('../components/AnalysisStore');
  if (!isAnalysisStoreReadOnlyMock(analysisStoreMock))
    throw new Error('Expected the AnalysisStore manual mock with read-only controls');
  const { __setMockAnalysisReadOnly: setReadOnly } = analysisStoreMock;
  setReadOnly(value);
}
