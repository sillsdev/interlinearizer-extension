/**
 * Jest mock for @papi/backend. Provides papi and logger so main.ts can be unit-tested without
 * loading the real Platform API.
 *
 * This is the single mock for @papi/backend. Jest's moduleNameMapper in jest.config.ts maps
 * '^@papi/backend$' to this file; the __mocks__/@papi/backend.js location is not used so we
 * avoid maintaining two identical mocks.
 *
 * Main.ts uses: import papi, { logger } from '@papi/backend'. With esModuleInterop, default
 * export must be the papi object; logger as named export.
 */

const mockRegisterWebViewProvider = jest.fn().mockResolvedValue({ dispose: jest.fn() });
const mockOpenWebView = jest.fn().mockResolvedValue(undefined);
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const papi = {
  webViewProviders: {
    registerWebViewProvider: mockRegisterWebViewProvider,
  },
  webViews: {
    openWebView: mockOpenWebView,
  },
};

module.exports = {
  __mockRegisterWebViewProvider: mockRegisterWebViewProvider,
  __mockOpenWebView: mockOpenWebView,
  __mockLogger: mockLogger,
  default: papi,
  logger: mockLogger,
};
