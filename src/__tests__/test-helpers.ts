/**
 * @file Test helpers used to build type-safe mocks without type assertions. Provides a minimal
 *   ExecutionActivationContext that satisfies @papi/core types, and a stable path resolver for the
 *   test-data directory.
 */
import * as path from 'path';

import type { ExecutionActivationContext } from '@papi/core';
import { UnsubscriberAsyncList } from 'platform-bible-utils';

/**
 * Resolves a path to a file under the project's test-data directory.
 *
 * @param relativePath - Filename or path relative to test-data (e.g. 'Interlinear_en_JHN.xml').
 * @returns Absolute path to the file under test-data.
 */
export function getTestDataPath(relativePath: string): string {
  return path.resolve(__dirname, '..', '..', 'test-data', relativePath);
}

/** Minimal execution token-shaped object for tests (structural match for ExecutionToken). */
const mockExecutionToken: {
  type: 'extension';
  name: string;
  nonce: string;
  getHash: () => string;
} = {
  type: 'extension',
  name: 'interlinearizer-test',
  nonce: 'test-nonce',
  getHash: (): string => 'test-hash',
};

/** Minimal elevated privileges for tests (all properties optional per papi type). */
const mockElevatedPrivileges = {
  createProcess: undefined,
  manageExtensions: undefined,
  handleUri: undefined,
};

/**
 * Builds a minimal ExecutionActivationContext for unit testing activate(). Uses
 * UnsubscriberAsyncList from the platform-bible-utils Jest mock.
 *
 * @returns Context that satisfies ExecutionActivationContext for tests that only use
 *   registrations.add
 */
export function createTestActivationContext(): ExecutionActivationContext {
  return {
    name: 'interlinearizer-test',
    executionToken: mockExecutionToken,
    elevatedPrivileges: mockElevatedPrivileges,
    registrations: new UnsubscriberAsyncList('test'),
  };
}
