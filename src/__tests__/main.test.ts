/** @file Unit tests for the extension entry point (main.ts). */
/// <reference types="jest" />

import type { SavedWebViewDefinition } from '@papi/core';
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
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockNotificationsSend: jest.Mock;
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
    '__mockReadUserData' in m &&
    '__mockWriteUserData' in m &&
    '__mockNotificationsSend' in m &&
    '__mockLogger' in m
  );
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
  __mockReadUserData,
  __mockWriteUserData,
  __mockNotificationsSend,
  __mockLogger,
} = papiBackendMock;

function isCallable(f: unknown): f is (...args: unknown[]) => unknown {
  return typeof f === 'function';
}

function findRegisteredHandler(commandName: string): ((...args: unknown[]) => unknown) | undefined {
  const call = jest.mocked(__mockRegisterCommand).mock.calls.find((c) => c[0] === commandName);
  const rawHandler: unknown = call?.[1];
  return isCallable(rawHandler) ? rawHandler : undefined;
}

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

function getOpenWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidOpenWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidOpenWebView callback not found');
  return (event) => cb(event);
}

function getCloseWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidCloseWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidCloseWebView callback not found');
  return (event) => cb(event);
}

async function getCreateProjectHandler(): Promise<
  (analysisWritingSystem: string) => Promise<string | undefined>
> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler('interlinearizer.createProject');
  if (!rawHandler) throw new Error('Handler not found for interlinearizer.createProject');
  return async (ws: string): Promise<string | undefined> => {
    const result: unknown = await rawHandler(ws);
    return typeof result === 'string' ? result : undefined;
  };
}

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
    __mockReadUserData.mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    );
    __mockWriteUserData.mockResolvedValue(undefined);
    __mockNotificationsSend.mockResolvedValue('mock-notification-id');
    jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
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
    type WebViewProvider = {
      getWebView(saved: SavedWebViewDefinition, opts?: object): Promise<unknown>;
    };

    function isWebViewProvider(x: unknown): x is WebViewProvider {
      return (
        !!x && typeof x === 'object' && 'getWebView' in x && typeof x.getWebView === 'function'
      );
    }

    /** Retrieves the provider registered with the platform and asserts it exists. */
    function getRegisteredProvider(): WebViewProvider {
      const raw = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      if (!isWebViewProvider(raw)) throw new Error('Expected registered provider');
      return raw;
    }

    it('returns WebView definition when webViewType matches', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
      };

      const result = await provider.getWebView(savedWebView, {});

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

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
      };

      const options: InterlinearizerOpenOptions = { projectId: 'my-project' };
      const result = await provider.getWebView(savedWebView, options);

      expect(result).toMatchObject({ projectId: 'my-project' });
    });

    it('falls back to savedWebView.projectId when options has no projectId', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
        projectId: 'saved-project',
      };

      const result = await provider.getWebView(savedWebView, {});

      expect(result).toMatchObject({ projectId: 'saved-project' });
    });

    it('throws when webViewType does not match', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'other-id',
        webViewType: 'other.webView',
      };

      await expect(provider.getWebView(savedWebView, {})).rejects.toThrow(
        `${mainWebViewType} provider received request to provide a ${savedWebView.webViewType} WebView`,
      );
    });

    it('falls back to savedWebView.projectId when options is undefined', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
        projectId: 'saved-project',
      };

      const result = await provider.getWebView(savedWebView, undefined);

      expect(result).toMatchObject({ projectId: 'saved-project' });
    });
  });

  describe('interlinearizer.openForWebView command', () => {
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

  describe('interlinearizer.createProject command', () => {
    it('registers the interlinearizer.createProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('creates and returns the new project ID when both pickers are confirmed', async () => {
      __mockSelectProject.mockResolvedValueOnce('src-project').mockResolvedValueOnce('tgt-project');
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBe('00000000-0000-0000-0000-000000000000');
      expect(__mockWriteUserData).toHaveBeenCalledWith(
        expect.anything(),
        'project:00000000-0000-0000-0000-000000000000',
        expect.stringContaining('"sourceProjectId":"src-project"'),
      );
    });

    it('returns undefined when the source picker is cancelled', async () => {
      __mockSelectProject.mockResolvedValue(undefined);
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('returns undefined when the target picker is cancelled', async () => {
      __mockSelectProject.mockResolvedValueOnce('src-project').mockResolvedValueOnce(undefined);
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('sends a warning notification and re-prompts when target equals source', async () => {
      __mockSelectProject
        .mockResolvedValueOnce('src-project')
        .mockResolvedValueOnce('src-project')
        .mockResolvedValueOnce('tgt-project');
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBe('00000000-0000-0000-0000-000000000000');
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning' }),
      );
      expect(__mockSelectProject).toHaveBeenCalledTimes(3);
    });

    it('returns undefined when the user cancels the target picker after a same-project warning', async () => {
      __mockSelectProject
        .mockResolvedValueOnce('src-project')
        .mockResolvedValueOnce('src-project')
        .mockResolvedValueOnce(undefined);
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBeUndefined();
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning' }),
      );
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('logs the error, sends an error notification, and returns undefined when storage fails', async () => {
      __mockSelectProject.mockResolvedValueOnce('src-project').mockResolvedValueOnce('tgt-project');
      __mockWriteUserData.mockRejectedValue(new Error('disk full'));
      const handler = await getCreateProjectHandler();

      const result = await handler('en');

      expect(result).toBeUndefined();
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to create project',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  describe('WebView lifecycle event subscriptions', () => {
    it('subscribes to onDidOpenWebView and onDidCloseWebView during activation', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockOnDidOpenWebView).toHaveBeenCalledTimes(1);
      expect(__mockOnDidCloseWebView).toHaveBeenCalledTimes(1);
    });

    describe('onDidOpenWebView callback', () => {
      it('adds the webView to the project map so subsequent opens reuse the existing tab', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'tab-from-event', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.objectContaining({ existingId: 'tab-from-event', projectId: 'my-project' }),
        );
      });

      it('ignores webViews with a non-matching webViewType', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'other-tab', webViewType: 'other.webView', projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.not.objectContaining({ existingId: expect.any(String) }),
        );
      });

      it('ignores webViews with no projectId', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'no-project-tab', webViewType: mainWebViewType },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.not.objectContaining({ existingId: expect.any(String) }),
        );
      });
    });

    describe('onDidCloseWebView callback', () => {
      it('removes the project map entry so the next open creates a new tab', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.not.objectContaining({ existingId: expect.any(String) }),
        );
      });

      it('does not remove the project map entry when a different webView closes', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'other-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.objectContaining({ existingId: 'my-tab' }),
        );
      });

      it('ignores close events for webViews with a non-matching webViewType', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'my-tab', webViewType: 'other.webView', projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.objectContaining({ existingId: 'my-tab' }),
        );
      });

      it('ignores close events for webViews with no projectId', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({ webView: { id: 'my-tab', webViewType: mainWebViewType } });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.objectContaining({ existingId: 'my-tab' }),
        );
      });
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
