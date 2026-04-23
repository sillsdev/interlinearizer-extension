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
  __mockGetOpenWebViewDefinition: jest.Mock;
  __mockOnDidOpenWebView: jest.Mock;
  __mockOnDidCloseWebView: jest.Mock;
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
    '__mockGetOpenWebViewDefinition' in m &&
    '__mockOnDidOpenWebView' in m &&
    '__mockOnDidCloseWebView' in m &&
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
  __mockGetOpenWebViewDefinition,
  __mockOnDidOpenWebView,
  __mockOnDidCloseWebView,
  __mockLogger,
} = papiBackendMock;

describe('main', () => {
  const mainWebViewType = 'interlinearizer.mainWebView';

  afterEach(() => deactivate());

  beforeEach(() => {
    __mockRegisterWebViewProvider.mockResolvedValue({ dispose: jest.fn() });
    __mockRegisterCommand.mockResolvedValue({ dispose: jest.fn() });
    __mockOpenWebView.mockResolvedValue('mock-webview-id');
    __mockSelectProject.mockResolvedValue(undefined);
    __mockGetOpenWebViewDefinition.mockResolvedValue(undefined);
    __mockOnDidOpenWebView.mockReturnValue(jest.fn());
    __mockOnDidCloseWebView.mockReturnValue(jest.fn());
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

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.open',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('registers the interlinearizer.openForWebView command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.openForWebView',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('adds all five registrations to the activation context', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(context.registrations.unsubscribers.size).toBe(5);
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

    it('falls back to savedWebView.projectId when options is undefined', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const rawProvider = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      if (!isIWebViewProvider(rawProvider)) throw new Error('Expected registered provider');
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
        projectId: 'saved-project',
      };

      // @ts-expect-error -- intentionally passing undefined to test the defensive fallback path
      const result = await rawProvider.getWebView(savedWebView, undefined, 'test-nonce');

      expect(result).toMatchObject({ projectId: 'saved-project' });
    });
  });

  function isCallable(f: unknown): f is (...args: unknown[]) => unknown {
    return typeof f === 'function';
  }

  function findRegisteredHandler(
    commandName: string,
  ): ((...args: unknown[]) => unknown) | undefined {
    const call = jest.mocked(__mockRegisterCommand).mock.calls.find((c) => c[0] === commandName);
    const rawHandler: unknown = call?.[1];
    return isCallable(rawHandler) ? rawHandler : undefined;
  }

  describe('interlinearizer.open command', () => {
    async function getOpenHandler(): Promise<(projectId?: string) => Promise<string | undefined>> {
      const context = createTestActivationContext();
      await activate(context);
      const rawHandler = findRegisteredHandler('interlinearizer.open');
      if (!rawHandler) throw new Error('Handler not found for interlinearizer.open');
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

    it('reuses the WebView ID on subsequent opens of the same project', async () => {
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

    it('returns the WebView ID when the WebView opens successfully', async () => {
      __mockOpenWebView.mockResolvedValue('new-webview-id');
      const open = await getOpenHandler();

      const result = await open('project-return-id');

      expect(result).toBe('new-webview-id');
    });
  });

  describe('interlinearizer.openForWebView command', () => {
    async function getOpenForWebViewHandler(): Promise<
      (webViewId?: string) => Promise<string | undefined>
    > {
      const context = createTestActivationContext();
      await activate(context);
      const rawHandler = findRegisteredHandler('interlinearizer.openForWebView');
      if (!rawHandler) throw new Error('Handler not found for interlinearizer.openForWebView');
      return async (webViewId?: string): Promise<string | undefined> => {
        const result: unknown = await rawHandler(webViewId);
        return typeof result === 'string' ? result : undefined;
      };
    }

    it('looks up the projectId from the given WebView and opens the Interlinearizer', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue({
        id: 'some-webview',
        webViewType: 'someExtension.view',
        projectId: 'project-from-webview',
      });
      const openForWebView = await getOpenForWebViewHandler();

      await openForWebView('some-webview');

      expect(__mockGetOpenWebViewDefinition).toHaveBeenCalledWith('some-webview');
      expect(__mockSelectProject).not.toHaveBeenCalled();
      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ projectId: 'project-from-webview' }),
      );
    });

    it('shows a project picker when the WebView has no projectId', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue({
        id: 'some-webview',
        webViewType: 'someExtension.view',
      });
      __mockSelectProject.mockResolvedValue('picker-project');
      const openForWebView = await getOpenForWebViewHandler();

      await openForWebView('some-webview');

      expect(__mockSelectProject).toHaveBeenCalledTimes(1);
      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ projectId: 'picker-project' }),
      );
    });

    it('shows a project picker when the WebView definition is not found', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue(undefined);
      __mockSelectProject.mockResolvedValue('picker-project');
      const openForWebView = await getOpenForWebViewHandler();

      await openForWebView('nonexistent-webview');

      expect(__mockSelectProject).toHaveBeenCalledTimes(1);
    });

    it('shows a project picker when no webViewId is provided', async () => {
      __mockSelectProject.mockResolvedValue('picker-project');
      const openForWebView = await getOpenForWebViewHandler();

      await openForWebView();

      expect(__mockGetOpenWebViewDefinition).not.toHaveBeenCalled();
      expect(__mockSelectProject).toHaveBeenCalledTimes(1);
      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ projectId: 'picker-project' }),
      );
    });

    it('returns undefined when the user cancels the project picker', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue(undefined);
      __mockSelectProject.mockResolvedValue(undefined);
      const openForWebView = await getOpenForWebViewHandler();

      const result = await openForWebView('some-webview');

      expect(result).toBeUndefined();
      expect(__mockOpenWebView).not.toHaveBeenCalled();
    });

    it('returns the WebView ID when the Interlinearizer opens successfully', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue({
        id: 'src-webview',
        webViewType: 'someExtension.view',
        projectId: 'my-project',
      });
      __mockOpenWebView.mockResolvedValue('interlinearizer-webview-id');
      const openForWebView = await getOpenForWebViewHandler();

      const result = await openForWebView('src-webview');

      expect(result).toBe('interlinearizer-webview-id');
    });
  });

  describe('WebView lifecycle event subscriptions', () => {
    type WebViewEvent = (event: {
      webView: { webViewType: string; id: string; projectId?: string };
    }) => void;

    it('subscribes to onDidOpenWebView and onDidCloseWebView during activation', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockOnDidOpenWebView).toHaveBeenCalledTimes(1);
      expect(__mockOnDidCloseWebView).toHaveBeenCalledTimes(1);
    });

    it('populates openWebViewsByProject when a matching WebView opens', async () => {
      const context = createTestActivationContext();
      await activate(context);
      const onOpen: WebViewEvent = __mockOnDidOpenWebView.mock.calls[0][0];

      onOpen({ webView: { webViewType: mainWebViewType, id: 'wv-1', projectId: 'proj-a' } });

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-a');

      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: 'wv-1', projectId: 'proj-a' }),
      );
    });

    it('ignores onDidOpenWebView events for other WebView types', async () => {
      const context = createTestActivationContext();
      await activate(context);
      const onOpen: WebViewEvent = __mockOnDidOpenWebView.mock.calls[0][0];

      onOpen({ webView: { webViewType: 'other.webView', id: 'wv-x', projectId: 'proj-x' } });

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-x');

      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: undefined }),
      );
    });

    it('ignores onDidOpenWebView events with no projectId', async () => {
      const context = createTestActivationContext();
      await activate(context);
      const onOpen: WebViewEvent = __mockOnDidOpenWebView.mock.calls[0][0];

      onOpen({ webView: { webViewType: mainWebViewType, id: 'wv-no-project' } });

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-no-project');

      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: undefined }),
      );
    });

    it('removes the entry from the map when the matching WebView closes', async () => {
      __mockOpenWebView.mockResolvedValue('wv-close');
      const context = createTestActivationContext();
      await activate(context);

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-close');

      const onClose: WebViewEvent = __mockOnDidCloseWebView.mock.calls[0][0];
      onClose({
        webView: { webViewType: mainWebViewType, id: 'wv-close', projectId: 'proj-close' },
      });

      __mockOpenWebView.mockResolvedValue('wv-new');
      await open('proj-close');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: undefined, projectId: 'proj-close' }),
      );
    });

    it('does not remove the entry when a different WebView ID closes for the same project', async () => {
      __mockOpenWebView.mockResolvedValue('wv-current');
      const context = createTestActivationContext();
      await activate(context);

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-stale');

      const onClose: WebViewEvent = __mockOnDidCloseWebView.mock.calls[0][0];
      onClose({
        webView: { webViewType: mainWebViewType, id: 'wv-old', projectId: 'proj-stale' },
      });

      await open('proj-stale');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: 'wv-current', projectId: 'proj-stale' }),
      );
    });

    it('ignores onDidCloseWebView events for other WebView types', async () => {
      __mockOpenWebView.mockResolvedValue('wv-other-type');
      const context = createTestActivationContext();
      await activate(context);

      const open = findRegisteredHandler('interlinearizer.open');
      if (!open) throw new Error('Handler not found');
      await open('proj-other-type');

      const onClose: WebViewEvent = __mockOnDidCloseWebView.mock.calls[0][0];
      onClose({
        webView: {
          webViewType: 'other.webView',
          id: 'wv-other-type',
          projectId: 'proj-other-type',
        },
      });

      await open('proj-other-type');

      expect(__mockOpenWebView).toHaveBeenLastCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ existingId: 'wv-other-type', projectId: 'proj-other-type' }),
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
