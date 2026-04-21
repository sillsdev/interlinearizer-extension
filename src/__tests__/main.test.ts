/** @file Unit tests for the extension entry point (main.ts). */
/// <reference types="jest" />

import type { IWebViewProvider, SavedWebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '@main';
import type { InterlinearizerOpenOptions } from '@main';
import { createTestActivationContext } from './test-helpers';

/** Shape of the Jest-mocked @papi/backend default export used in these tests. */
interface PapiBackendTestMock {
  __mockRegisterWebViewProvider: jest.Mock;
  __mockRegisterCommand: jest.Mock;
  __mockOpenWebView: jest.Mock;
  __mockSelectProject: jest.Mock;
  __mockLogger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}

/**
 * Type guard for the mocked @papi/backend default export. Allows destructuring mocks without type
 * assertions.
 */
function isPapiBackendTestMock(m: unknown): m is PapiBackendTestMock {
  return (
    !!m &&
    typeof m === 'object' &&
    '__mockRegisterWebViewProvider' in m &&
    '__mockRegisterCommand' in m &&
    '__mockOpenWebView' in m &&
    '__mockSelectProject' in m &&
    '__mockLogger' in m
  );
}

/**
 * Type guard for the WebView provider passed to registerWebViewProvider. Used to obtain a properly
 * typed provider from the mock without type assertions.
 */
function isIWebViewProvider(x: unknown): x is IWebViewProvider {
  return !!x && typeof x === 'object' && 'getWebView' in x && typeof x.getWebView === 'function';
}

if (!isPapiBackendTestMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend');
const {
  __mockRegisterWebViewProvider,
  __mockRegisterCommand,
  __mockOpenWebView,
  __mockSelectProject,
  __mockLogger,
} = papiBackendMock;

describe('main', () => {
  const mainWebViewType = 'interlinearizer.mainWebView';

  beforeEach(() => {
    __mockRegisterWebViewProvider.mockResolvedValue({ dispose: jest.fn() });
    __mockRegisterCommand.mockResolvedValue({ dispose: jest.fn() });
    __mockOpenWebView.mockResolvedValue('mock-webview-id');
    __mockSelectProject.mockResolvedValue(undefined);
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

    it('registers the interlinearizer.open command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledTimes(1);
      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.open',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('adds both registrations to the activation context', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(context.registrations.unsubscribers.size).toBe(2);
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

    it('propagates projectId from options into the WebView definition', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const rawProvider = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      if (!isIWebViewProvider(rawProvider)) throw new Error('Expected registered provider');
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
      };

      const options: InterlinearizerOpenOptions = { projectId: 'my-project' };
      const result = await rawProvider.getWebView(savedWebView, options, 'test-nonce');

      expect(result).toMatchObject({ projectId: 'my-project' });
    });

    it('falls back to savedWebView.projectId when options has no projectId', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const rawProvider = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      if (!isIWebViewProvider(rawProvider)) throw new Error('Expected registered provider');
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
        projectId: 'saved-project',
      };

      const result = await rawProvider.getWebView(savedWebView, {}, 'test-nonce');

      expect(result).toMatchObject({ projectId: 'saved-project' });
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

  describe('interlinearizer.open command', () => {
    /** Extracts the registered command handler from the mock after activate(). */
    async function getOpenHandler(): Promise<(projectId?: string) => Promise<string | undefined>> {
      const context = createTestActivationContext();
      await activate(context);
      const rawHandler: unknown = jest.mocked(__mockRegisterCommand).mock.calls[0]?.[1];
      if (typeof rawHandler !== 'function') throw new Error('Expected command handler');
      return (projectId?: string): Promise<string | undefined> => {
        const result: unknown = rawHandler(projectId);
        if (!(result instanceof Promise)) return Promise.resolve(undefined);
        return result.then((v: unknown) => (typeof v === 'string' ? v : undefined));
      };
    }

    it('opens a new tab with the given projectId on the first open', async () => {
      const open = await getOpenHandler();

      await open('project-first-open');

      expect(__mockSelectProject).not.toHaveBeenCalled();
      expect(__mockOpenWebView).toHaveBeenCalledWith(mainWebViewType, undefined, {
        projectId: 'project-first-open',
        existingId: undefined,
      });
    });

    it('reuses the webview ID on subsequent opens of the same project', async () => {
      __mockOpenWebView.mockResolvedValue('saved-webview-id');
      const open = await getOpenHandler();

      await open('project-reuse');
      await open('project-reuse');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: 'saved-webview-id', projectId: 'project-reuse' }),
      );
    });

    it('opens a new tab for a different project', async () => {
      __mockOpenWebView
        .mockResolvedValueOnce('project-c-webview-id')
        .mockResolvedValueOnce('project-d-webview-id');
      const open = await getOpenHandler();

      await open('project-c');
      await open('project-d');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: undefined, projectId: 'project-d' }),
      );
    });

    it('shows a project picker when no projectId is provided', async () => {
      __mockSelectProject.mockResolvedValue('project-picked');
      const open = await getOpenHandler();

      await open();

      expect(__mockSelectProject).toHaveBeenCalledTimes(1);
      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ projectId: 'project-picked' }),
      );
    });

    it('returns undefined when the user cancels the project picker', async () => {
      __mockSelectProject.mockResolvedValue(undefined);
      const open = await getOpenHandler();

      const result = await open();

      expect(result).toBeUndefined();
      expect(__mockOpenWebView).not.toHaveBeenCalled();
    });

    it('does not store a mapping when openWebView returns undefined', async () => {
      __mockOpenWebView.mockResolvedValueOnce(undefined).mockResolvedValueOnce('later-id');
      const open = await getOpenHandler();

      await open('project-failed-open');
      await open('project-failed-open');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: undefined, projectId: 'project-failed-open' }),
      );
    });

    it('returns the webview ID when the webview opens successfully', async () => {
      __mockOpenWebView.mockResolvedValue('new-webview-id');
      const open = await getOpenHandler();

      const result = await open('project-return-id');

      expect(result).toBe('new-webview-id');
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
