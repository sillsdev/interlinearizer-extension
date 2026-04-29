/**
 * @file Jest mock for @papi/backend. Provides papi and logger so main.ts can be unit-tested without
 * loading the real Platform API.
 */

const mockRegisterWebViewProvider = jest.fn();
const mockRegisterCommand = jest.fn();
const mockOpenWebView = jest.fn();
const mockSelectProject = jest.fn();
const mockGetOpenWebViewDefinition = jest.fn();
const mockOnDidOpenWebView = jest.fn();
const mockOnDidCloseWebView = jest.fn();
const mockReadUserData = jest.fn();
const mockWriteUserData = jest.fn();
const mockDeleteUserData = jest.fn();
const mockNotificationsSend = jest.fn();
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const papi = {
  commands: {
    registerCommand: mockRegisterCommand,
  },
  dialogs: {
    selectProject: mockSelectProject,
  },
  notifications: {
    send: mockNotificationsSend,
  },
  storage: {
    readUserData: mockReadUserData,
    writeUserData: mockWriteUserData,
    deleteUserData: mockDeleteUserData,
  },
  webViewProviders: {
    registerWebViewProvider: mockRegisterWebViewProvider,
  },
  webViews: {
    openWebView: mockOpenWebView,
    getOpenWebViewDefinition: mockGetOpenWebViewDefinition,
    onDidOpenWebView: mockOnDidOpenWebView,
    onDidCloseWebView: mockOnDidCloseWebView,
  },
};

const defaultExport = {
  ...papi,
  __mockRegisterWebViewProvider: mockRegisterWebViewProvider,
  __mockRegisterCommand: mockRegisterCommand,
  __mockOpenWebView: mockOpenWebView,
  __mockSelectProject: mockSelectProject,
  __mockGetOpenWebViewDefinition: mockGetOpenWebViewDefinition,
  __mockOnDidOpenWebView: mockOnDidOpenWebView,
  __mockOnDidCloseWebView: mockOnDidCloseWebView,
  __mockReadUserData: mockReadUserData,
  __mockWriteUserData: mockWriteUserData,
  __mockDeleteUserData: mockDeleteUserData,
  __mockNotificationsSend: mockNotificationsSend,
  __mockLogger: mockLogger,
};

module.exports = {
  __esModule: true,
  default: defaultExport,
  logger: mockLogger,
};

/** Marks this file as a module so top-level const/let are module-scoped; avoids TS "redeclare" when both papi-backend and papi-frontend mocks are in the project (they are used mutually exclusively by Jest). */
export {};
