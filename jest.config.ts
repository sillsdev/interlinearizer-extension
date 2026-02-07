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
  // All imported modules in your tests should be mocked automatically
  // automock: false,

  // Stop running tests after `n` failures
  // bail: 0,

  // The directory where Jest should store its cached dependency information
  // cacheDirectory: "/tmp/jest_rs",

  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,

  // Coverage only when run with --coverage (see npm run test:coverage). Omit for faster default test runs.
  collectCoverage: false,

  /**
   * Collect coverage from parsers, main entry (main.ts), and WebView UI
   * (interlinearizer.web-view.tsx). Excludes test files, type declarations, and build artifacts.
   */
  collectCoverageFrom: [
    'src/parsers/**/*.ts',
    'src/main.ts',
    'src/**/*.web-view.tsx',
    '!src/parsers/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
  ],

  // The directory where Jest should output its coverage files
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

  // A list of reporter names that Jest uses when writing coverage reports
  // coverageReporters: [
  //   "json",
  //   "text",
  //   "lcov",
  //   "clover"
  // ],

  /** Enforce 100% coverage on parsers, main, and web-view. */
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },

  // A path to a custom dependency extractor
  // dependencyExtractor: undefined,

  // Make calling deprecated APIs throw helpful error messages
  // errorOnDeprecated: false,

  // The default configuration for fake timers
  // fakeTimers: {
  //   "enableGlobally": false
  // },

  // Force coverage collection from ignored files using an array of glob patterns
  // forceCoverageMatch: [],

  // A path to a module which exports an async function that is triggered once before all test suites
  // globalSetup: undefined,

  // A path to a module which exports an async function that is triggered once after all test suites
  // globalTeardown: undefined,

  // A set of global variables that need to be available in all test environments
  // globals: {},

  // The maximum amount of workers used to run your tests. Can be specified as % or a number. E.g. maxWorkers: 10% will use 10% of your CPU amount + 1 as the maximum worker number. maxWorkers: 2 will use a maximum of 2 workers.
  // maxWorkers: "50%",

  // An array of directory names to be searched recursively up from the requiring module's location
  // moduleDirectories: [
  //   "node_modules"
  // ],

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
    /** Mock Platform API for unit tests; main.ts imports papi and logger. */
    '^@papi/backend$': '<rootDir>/__mocks__/papi-backend.ts',
    /** Mock Platform core types; main.ts imports types only (erased at runtime). */
    '^@papi/core$': '<rootDir>/__mocks__/papi-core.ts',
    /** Mock so test-helpers get UnsubscriberAsyncList without loading ESM deps. */
    '^platform-bible-utils$': '<rootDir>/__mocks__/platform-bible-utils.ts',
    /** Resolve webpack ?inline imports: web-view component for main.ts. */
    '^(.+)\\.web-view\\?inline$': '<rootDir>/__mocks__/web-view-inline.ts',
    /** Resolve webpack ?inline imports: SCSS content. */
    '^(.+)\\.(scss|sass|css)\\?inline$': '<rootDir>/__mocks__/styleInlineMock.ts',
    /** Resolve webpack ?raw import for test XML in web-view. */
    '^(.+)/Interlinear_en_MAT\\.xml\\?raw$': '<rootDir>/__mocks__/interlinearXmlContent.ts',
  },

  /** Exclude dist from module resolution to avoid Haste naming collision with root package.json. */
  modulePathIgnorePatterns: ['<rootDir>/dist'],

  // Activates notifications for test results
  // notify: false,

  // An enum that specifies notification mode. Requires { notify: true }
  // notifyMode: "failure-change",

  // A preset that is used as a base for Jest's configuration
  // preset: undefined,

  // Run tests from one or more projects
  // projects: undefined,

  // Use this configuration option to add custom reporters to Jest
  // reporters: undefined,

  // Automatically reset mock state before every test
  // resetMocks: false,

  // Reset the module registry before running each individual test
  // resetModules: false,

  // A path to a custom resolver
  // resolver: undefined,

  // Automatically restore mock state and implementation before every test
  // restoreMocks: false,

  // The root directory that Jest should scan for tests and modules within
  // rootDir: undefined,

  // A list of paths to directories that Jest should use to search for files in
  // roots: [
  //   "<rootDir>"
  // ],

  // Allows you to use a custom runner instead of Jest's default test runner
  // runner: "jest-runner",

  // The paths to modules that run some code to configure or set up the testing environment before each test
  // setupFiles: [],

  /** Load @testing-library/jest-dom matchers for React component tests. */
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // The number of seconds after which a test is considered as slow and reported as such in the results.
  // slowTestThreshold: 5,

  // A list of paths to snapshot serializer modules Jest should use for snapshot testing
  // snapshotSerializers: [],

  /** Use jsdom for React component tests; parser tests run fine in jsdom (no DOM use). */
  testEnvironment: 'jsdom',

  // Options that will be passed to the testEnvironment
  // testEnvironmentOptions: {},

  // Adds a location field to test results
  // testLocationInResults: false,

  /**
   * Only treat _.test._ and _.spec._ as test files so that helpers (e.g. test-helpers.ts) in
   * **tests** are never discovered by Jest or the VS Code Jest extension.
   */
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],

  /** Do not run tests from build output or dependencies. */
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // The regexp pattern or array of patterns that Jest uses to detect test files
  // testRegex: [],

  // This option allows the use of a custom results processor
  // testResultsProcessor: undefined,

  // This option allows use of a custom test runner
  // testRunner: "jest-circus/runner",

  /**
   * Transform TS/TSX with ts-jest (webpack uses SWC; Jest does not run webpack). Explicitly list
   * ts-jest so other preprocessors can be added later without dropping TS support.
   */
  transform: {
    '\\.[jt]sx?$': 'ts-jest',
  },

  // An array of regexp pattern strings that are matched against all source file paths, matched files will skip transformation
  // transformIgnorePatterns: [
  //   "/node_modules/",
  //   "\\.pnp\\.[^\\/]+$"
  // ],

  // An array of regexp pattern strings that are matched against all modules before the module loader will automatically return a mock for them
  // unmockedModulePathPatterns: undefined,

  // Indicates whether each individual test should be reported during the run
  // verbose: undefined,

  // An array of regexp patterns that are matched against all source file paths before re-running tests in watch mode
  // watchPathIgnorePatterns: [],

  // Whether to use watchman for file crawling
  // watchman: true,
};

export default config;
