/**
 * Jest configuration for the tests that run the published C# host: they need `dotnet` and `npm run
 * build:c-sharp` to have run, so the default configuration leaves them out.
 */

import type { Config } from 'jest';
import base from './jest.config.ts';

const config: Config = {
  ...base,
  /** Where the C# host tests live; the default configuration ignores it. */
  testMatch: ['**/__tests__/c-sharp-host/**/*.test.ts'],
  testPathIgnorePatterns: base.testPathIgnorePatterns?.filter(
    (pattern) => pattern !== '/c-sharp-host/',
  ),
  /** They spawn a process and open a socket, which need Node rather than a browser. */
  testEnvironment: 'node',
  setupFilesAfterEnv: [],
  /** Each test waits on the host's SQLite writes, and the first on its start. */
  testTimeout: 30_000,
};

export default config;
