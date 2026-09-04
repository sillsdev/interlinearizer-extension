/**
 * @file Jest mock for @papi/frontend. Provides a logger stub and a minimal papi object so
 * WebView/frontend components can be unit-tested without loading the real Platform API.
 */

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const mockSendCommand = jest.fn();
const mockNotificationsSend = jest.fn();
const mockProjectDataProvidersGet = jest.fn();
const mockNetworkObjectsGet = jest.fn();
const mockWaitForNetworkObject = jest.fn();

const papi = {
  commands: {
    sendCommand: mockSendCommand,
  },
  notifications: {
    send: mockNotificationsSend,
  },
  menuData: {
    dataProviderName: 'platform.menuDataServiceDataProvider',
  },
  projectDataProviders: {
    get: mockProjectDataProvidersGet,
  },
  networkObjects: {
    get: mockNetworkObjectsGet,
  },
  networkObjectStatus: {
    waitForNetworkObject: mockWaitForNetworkObject,
  },
};

module.exports = {
  __esModule: true,
  default: papi,
  logger: mockLogger,
};

/** Marks this file as a module so top-level const/let are module-scoped. */
export {};
