/**
 * Unit tests for the extension entry point (main.ts).
 *
 * Covers activate (provider registration, WebView open, error handling), deactivate, and the
 * WebView provider's getWebView (type match returns definition, type mismatch throws).
 */
/// <reference types="jest" />

import type { IWebViewProvider, SavedWebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '../main';
import { createTestActivationContext } from './test-helpers';

/** Shape of the Jest-mocked @papi/backend default export used in these tests. */
interface PapiBackendTestMock {
  __mockRegisterWebViewProvider: jest.Mock;
  __mockOpenWebView: jest.Mock;
  __mockLogger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}

/**
 * Type guard for the mocked @papi/backend default export. Allows destructuring mocks without type
 * assertions.
 */
function isPapiBackendTestMock(m: unknown): m is PapiBackendTestMock {
  return (
    typeof m === 'object' &&
    m !== undefined &&
    m instanceof Object &&
    '__mockRegisterWebViewProvider' in m &&
    '__mockOpenWebView' in m &&
    '__mockLogger' in m
  );
}

/**
 * Type guard for the WebView provider passed to registerWebViewProvider. Used to obtain a properly
 * typed provider from the mock without type assertions.
 */
function isIWebViewProvider(x: unknown): x is IWebViewProvider {
  if (x === undefined || (typeof x === 'object' && !(x instanceof Object))) return false;
  if (typeof x !== 'object') return false;
  if (!('getWebView' in x)) return false;
  return typeof x.getWebView === 'function';
}

jest.mock('@papi/backend', () => {
  const mockRegisterWebViewProvider = jest.fn().mockResolvedValue({ dispose: jest.fn() });
  const mockOpenWebView = jest.fn().mockResolvedValue(undefined);
  const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  const papi = {
    webViewProviders: { registerWebViewProvider: mockRegisterWebViewProvider },
    webViews: { openWebView: mockOpenWebView },
  };
  const mockExport = {
    ...papi,
    __mockRegisterWebViewProvider: mockRegisterWebViewProvider,
    __mockOpenWebView: mockOpenWebView,
    __mockLogger: mockLogger,
  };
  return {
    __esModule: true,
    default: mockExport,
    logger: mockLogger,
  };
});

if (!isPapiBackendTestMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend');
const { __mockRegisterWebViewProvider, __mockOpenWebView, __mockLogger } = papiBackendMock;

describe('main', () => {
  const mainWebViewType = 'interlinearizer.mainWebView';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('activate', () => {
    it('registers the WebView provider with the platform', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterWebViewProvider).toHaveBeenCalledTimes(1);
      expect(__mockRegisterWebViewProvider).toHaveBeenCalledWith(
        mainWebViewType,
        expect.objectContaining({
          getWebView: expect.any(Function),
        }),
      );
    });

    it('adds the registration to the activation context', async () => {
      const mockRegistration = { dispose: jest.fn() };
      jest.mocked(__mockRegisterWebViewProvider).mockResolvedValue(mockRegistration);
      const context = createTestActivationContext();

      await activate(context);

      expect(context.registrations.unsubscribers.size).toBe(1);
    });

    it('opens the WebView after registration', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockOpenWebView).toHaveBeenCalledWith(mainWebViewType, undefined, {
        existingId: '?',
      });
    });

    it('catches and logs when openWebView throws', async () => {
      const openError = new Error('WebView open failed');
      __mockOpenWebView.mockRejectedValue(openError);
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockLogger.error).toHaveBeenCalledWith(
        `Failed to open ${mainWebViewType} WebView: ${openError}`,
      );
    });

    it('logs activation start and finish', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockLogger.debug).toHaveBeenCalledWith('Interlinearizer extension is activating!');
      expect(__mockLogger.debug).toHaveBeenCalledWith(
        'Interlinearizer extension finished activating!',
      );
    });
  });

  describe('mainWebViewProvider.getWebView', () => {
    it('returns WebView definition when webViewType matches', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const rawProvider = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      expect(rawProvider).toBeDefined();
      if (!isIWebViewProvider(rawProvider)) throw new Error('Expected registered provider');
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
      };

      const result = await rawProvider.getWebView(savedWebView, {}, 'test-nonce');

      expect(result).toMatchObject({
        ...savedWebView,
        title: 'Interlinearizer',
        content: expect.any(Function),
        styles: '',
      });
    });

    it('throws when webViewType does not match', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const rawProvider = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      expect(rawProvider).toBeDefined();
      if (!isIWebViewProvider(rawProvider)) throw new Error('Expected registered provider');
      const savedWebView: SavedWebViewDefinition = {
        id: 'other-id',
        webViewType: 'other.webView',
      };

      await expect(rawProvider.getWebView(savedWebView, {}, 'test-nonce')).rejects.toThrow(
        `${mainWebViewType} provider received request to provide a ${savedWebView.webViewType} WebView`,
      );
    });
  });

  describe('deactivate', () => {
    it('returns true to indicate successful deactivation', async () => {
      const result = await deactivate();

      expect(result).toBe(true);
    });

    it('logs deactivation', async () => {
      await deactivate();

      expect(__mockLogger.debug).toHaveBeenCalledWith('Interlinearizer extension is deactivating!');
    });
  });
});
