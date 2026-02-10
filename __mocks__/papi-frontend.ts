/**
 * Jest mock for @papi/frontend. Provides papi, logger, network, projectDataProviders, and other
 * renderer API stubs so WebView/frontend code can be unit-tested without loading the real
 * Platform API.
 */

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const mockNetwork = {
  request: jest.fn(),
  subscribe: jest.fn().mockReturnValue({ dispose: jest.fn() }),
};

const mockProjectDataProviders = {
  get: jest.fn().mockResolvedValue(undefined),
  register: jest.fn().mockResolvedValue({ dispose: jest.fn() }),
};

const mockWebViews = {
  getWebView: jest.fn(),
  openWebView: jest.fn().mockResolvedValue(undefined),
};

/** Default papi object shape used in renderer/WebViews. Only commonly used services are stubbed. */
const papi = {
  logger: mockLogger,
  network: mockNetwork,
  projectDataProviders: mockProjectDataProviders,
  webViews: mockWebViews,
  react: {}, // Re-export of @papi/frontend/react; tests usually import that module directly.
};

const defaultExport = {
  ...papi,
  __mockLogger: mockLogger,
  __mockNetwork: mockNetwork,
  __mockProjectDataProviders: mockProjectDataProviders,
  __mockWebViews: mockWebViews,
};

module.exports = {
  __esModule: true,
  default: defaultExport,
  logger: mockLogger,
  network: mockNetwork,
  projectDataProviders: mockProjectDataProviders,
  webViews: mockWebViews,
  __mockLogger: mockLogger,
  __mockNetwork: mockNetwork,
  __mockProjectDataProviders: mockProjectDataProviders,
  __mockWebViews: mockWebViews,
};

/** Marks this file as a module so top-level const/let are module-scoped; avoids TS "redeclare" when both papi-backend and papi-frontend mocks are in the project (they are used mutually exclusively by Jest). */
export {};
