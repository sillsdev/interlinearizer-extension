/**
 * Jest configuration aligned with this project's webpack setup. Static assets (styles, images,
 * fonts) are mocked so tests don't run webpack loaders. TypeScript is transformed with ts-jest
 * (webpack uses SWC; we only need TS→JS for Jest).
 *
 * @see https://jestjs.io/docs/configuration
 * @see https://jestjs.io/docs/webpack
 */

import type { Config } from 'jest';

const config: Config = {
  /**
   * Reset mock implementations before every test (superset of clearMocks: also removes
   * mockReturnValue/mockImplementation so implementations never leak between tests). Each test must
   * set up the implementations it needs, typically in beforeEach.
   */
  resetMocks: true,

  /**
   * Restore spied-on methods to their original implementations before every test so that jest.spyOn
   * calls never accumulate across tests.
   */
  restoreMocks: true,

  /**
   * Coverage only when run with --coverage (see npm run test:coverage). Omit for faster default
   * test runs.
   */
  collectCoverage: false,

  /** Collect coverage from all source files. Excludes tests, types, and select utils. */
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/types/**',
  ],

  /** Directory for coverage output. */
  coverageDirectory: 'coverage',

  /** Skip coverage for node_modules, dist, and Jest/Webpack tooling. */
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/__mocks__/',
    '/webpack/',
    'jest.config.ts',
  ],

  /** Ts-jest compiles TS to JS; V8 instruments it for coverage. */
  coverageProvider: 'v8',

  /** Enforce 100% coverage on parsers, main, and web-view (except where explicitly excluded). */
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },

  /** Make calling deprecated Jest/Node APIs throw so we fix them instead of drifting. */
  errorOnDeprecated: true,

  /** Extensions resolved when importing; matches webpack.config.base resolve.extensions order. */
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  /**
   * Mock static assets so Jest does not run webpack loaders. Aligns with webpack.config.base rules
   * for styles, images, and fonts; also covers other common asset types (e.g. mp4, wav).
   */
  moduleNameMapper: {
    /**
     * Resolve src-rooted path aliases so tests can use e.g. "@main" or "parsers/..." instead of
     * relative paths. Must match tsconfig.json "paths" and webpack resolve.alias.
     */
    '^@main$': '<rootDir>/src/main',
    '^parsers/(.*)$': '<rootDir>/src/parsers/$1',
    '\\.(sa|sc|c)ss$': '<rootDir>/__mocks__/styleMock.ts',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/fileMock.ts',
    /** Mock Platform API for unit tests. */
    '^@papi/backend$': '<rootDir>/__mocks__/papi-backend.ts',
    /** Mock Platform core types. */
    '^@papi/core$': '<rootDir>/__mocks__/papi-core.ts',
    /** Mock renderer/WebView API for frontend unit tests. */
    '^@papi/frontend$': '<rootDir>/__mocks__/papi-frontend.ts',
    /** Mock PAPI React hooks for WebView component tests. */
    '^@papi/frontend/react$': '<rootDir>/__mocks__/papi-frontend-react.ts',
    /** Mock so test-helpers get UnsubscriberAsyncList without loading ESM deps. */
    '^platform-bible-utils$': '<rootDir>/__mocks__/platform-bible-utils.ts',
    /** Mock ESM deps that Jest cannot parse. */
    '^platform-bible-react$': '<rootDir>/__mocks__/platform-bible-react.tsx',
    /** Mock ESM-only icon library. */
    '^lucide-react$': '<rootDir>/__mocks__/lucide-react.tsx',
    /** Resolve webpack ?inline imports. */
    '^(.+)\\.web-view\\?inline$': '<rootDir>/__mocks__/web-view-inline.ts',
    /** Resolve webpack ?inline imports: SCSS content. */
    '^(.+)\\.(scss|sass|css)\\?inline$': '<rootDir>/__mocks__/styleInlineMock.ts',
  },

  /** Exclude dist from module resolution to avoid Haste naming collision with root package.json. */
  modulePathIgnorePatterns: ['<rootDir>/dist'],

  /** Load @testing-library/jest-dom matchers and browser API stubs for React component tests. */
  setupFilesAfterEnv: ['<rootDir>/jest.setup.resize-observer.js', '<rootDir>/jest.setup.ts'],

  /** Use jsdom for React component tests; parser tests run fine in jsdom (no DOM use). */
  testEnvironment: 'jsdom',

  /**
   * Only treat _.test._ and _.spec._ as test files so that helpers (e.g. test-helpers.ts) in
   * **tests** are never discovered by Jest or the VS Code Jest extension.
   */
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],

  /** Do not run tests from build output, e2e tests, or dependencies. */
  testPathIgnorePatterns: ['/dist/', '/e2e-tests/', '/node_modules/'],

  /**
   * Transform TS/TSX with ts-jest (webpack uses SWC; Jest does not run webpack). Explicitly list
   * ts-jest so other preprocessors can be added later without dropping TS support.
   */
  transform: {
    '\\.tsx?$': 'ts-jest',
  },
};

export default config;
