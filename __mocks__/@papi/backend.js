/**
 * Jest manual mock for @papi/backend. Jest auto-applies this when tests call
 * jest.mock('@papi/backend'). Provides papi and logger so main.ts can be unit-tested without the
 * real Platform API.
 *
 * Main.ts uses: import papi, { logger } from '@papi/backend'
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
