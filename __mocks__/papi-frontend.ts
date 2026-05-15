/**
 * @file Jest mock for @papi/frontend. Provides a logger stub so WebView/frontend code can be
 * unit-tested without loading the real Platform API.
 */

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const mockPapi = {
  menuData: {
    dataProviderName: 'platform.menuDataServiceDataProvider',
  },
};

module.exports = {
  __esModule: true,
  default: mockPapi,
  logger: mockLogger,
};

/** Marks this file as a module so top-level const/let are module-scoped. */
export {};
