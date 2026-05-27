/** @file Unit tests for the extension entry point (main.ts). */
/// <reference types="jest" />

import type { OpenWebViewOptions, SavedWebViewDefinition, WebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '@main';
import type { InterlinearizerOpenOptions } from '@main';
import * as projectStorage from '../services/projectStorage';
import { createTestActivationContext } from './test-helpers';

jest.mock('../services/projectStorage');

/** Shape of the Jest-mocked @papi/backend default export used in these tests. */
interface PapiBackendTestMock {
  __mockRegisterWebViewProvider: jest.Mock;
  __mockRegisterCommand: jest.Mock;
  __mockOpenWebView: jest.Mock;
  __mockSelectProject: jest.Mock;
  __mockGetOpenWebViewDefinition: jest.Mock;
  __mockOnDidOpenWebView: jest.Mock;
  __mockOnDidCloseWebView: jest.Mock;
  __mockRegisterValidator: jest.Mock;
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockNotificationsSend: jest.Mock;
  __mockLogger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}

/**
 * Type guard for the mocked @papi/backend default export. Allows destructuring mocks without type
 * assertions.
 *
 * @param m - The value to test, typically the default export of the mocked module.
 * @returns `true` if `m` exposes all expected `__mock*` properties.
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
    '__mockRegisterValidator' in m &&
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
  __mockRegisterValidator,
  __mockNotificationsSend,
  __mockLogger,
} = papiBackendMock;

/**
 * Type guard that narrows an unknown value to a callable function.
 *
 * @param f - The value to test.
 * @returns True if f is a function.
 */
function isCallable(f: unknown): f is (...args: unknown[]) => unknown {
  return typeof f === 'function';
}

type WebViewProvider = {
  getWebView(
    savedWebViewDefinition: SavedWebViewDefinition,
    openWebViewOptions: OpenWebViewOptions | undefined,
    webViewNonce?: string,
  ): Promise<WebViewDefinition | undefined>;
};

/**
 * Type guard that narrows an unknown value to a {@link WebViewProvider}.
 *
 * @param x - The value to test.
 * @returns `true` if `x` has a callable `getWebView` method.
 */
function isWebViewProvider(x: unknown): x is WebViewProvider {
  return !!x && typeof x === 'object' && 'getWebView' in x && typeof x.getWebView === 'function';
}

/** Retrieves the provider registered with the platform and asserts it exists. */
function getRegisteredProvider(): WebViewProvider {
  const raw = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
  if (!isWebViewProvider(raw)) throw new Error('Expected registered provider');
  return raw;
}

/**
 * Finds the handler registered for `commandName` in the most recent `activate()` call.
 *
 * @param commandName - The fully-qualified command name to look up.
 * @returns The registered handler function, or `undefined` if none was registered for that name.
 */
function findRegisteredHandler(commandName: string): ((...args: unknown[]) => unknown) | undefined {
  const call = jest.mocked(__mockRegisterCommand).mock.calls.find((c) => c[0] === commandName);
  const rawHandler: unknown = call?.[1];
  return isCallable(rawHandler) ? rawHandler : undefined;
}

/**
 * Activates the extension and returns a typed wrapper around the `interlinearizer.openForWebView`
 * command handler.
 *
 * @returns A function that invokes the handler with an optional WebView ID and resolves to the
 *   opened WebView ID string, or `undefined` if the handler returns a non-string.
 * @throws If the handler was not registered during `activate()`.
 */
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

/**
 * Retrieves the callback passed to onDidOpenWebView during the most recent activate() call.
 *
 * @returns A typed wrapper around the captured callback.
 * @throws If no callback was registered (i.e. activate was not called first).
 */
function getOpenWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidOpenWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidOpenWebView callback not found');
  return (event) => cb(event);
}

/**
 * Retrieves the callback passed to onDidCloseWebView during the most recent activate() call.
 *
 * @returns A typed wrapper around the captured callback.
 * @throws If no callback was registered (i.e. activate was not called first).
 */
function getCloseWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidCloseWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidCloseWebView callback not found');
  return (event) => cb(event);
}

/**
 * Activates the extension and returns a typed wrapper around the `interlinearizer.createProject`
 * command handler.
 *
 * @returns A function that invokes the handler with a source project ID and analysis languages,
 *   resolving to the JSON-stringified project or `undefined` if the handler returns a non-string.
 * @throws If the handler was not registered during `activate()`.
 */
async function getCreateProjectHandler(): Promise<
  (sourceProjectId: string, analysisLanguages: string[]) => Promise<string | undefined>
> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler('interlinearizer.createProject');
  if (!rawHandler) throw new Error('Handler not found for interlinearizer.createProject');
  return async (
    sourceProjectId: string,
    analysisLanguages: string[],
  ): Promise<string | undefined> => {
    const result: unknown = await rawHandler(sourceProjectId, analysisLanguages);
    return typeof result === 'string' ? result : undefined;
  };
}

/**
 * Activates the extension and returns a typed wrapper around the `interlinearizer.deleteProject`
 * command handler.
 *
 * @returns A function that invokes the handler with a project UUID and resolves when deletion
 *   completes.
 * @throws If the handler was not registered during `activate()`.
 */
async function getDeleteProjectHandler(): Promise<(id: string) => Promise<void>> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler('interlinearizer.deleteProject');
  if (!rawHandler) throw new Error('Handler not found for interlinearizer.deleteProject');
  return async (id: string): Promise<void> => {
    await rawHandler(id);
  };
}

/**
 * Activates the extension and returns a typed wrapper around the
 * `interlinearizer.getProjectsForSource` command handler.
 *
 * @returns A function that invokes the handler with a source project ID and resolves to the
 *   JSON-stringified project array (falls back to `'[]'` if the handler returns a non-string).
 * @throws If the handler was not registered during `activate()`.
 */
async function getProjectsForSourceHandler(): Promise<
  (sourceProjectId: string) => Promise<string>
> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler('interlinearizer.getProjectsForSource');
  if (!rawHandler) throw new Error('Handler not found for interlinearizer.getProjectsForSource');
  return async (sourceProjectId: string): Promise<string> => {
    const result: unknown = await rawHandler(sourceProjectId);
    return typeof result === 'string' ? result : '[]';
  };
}

/**
 * Activates the extension and returns a typed wrapper around the
 * `interlinearizer.updateProjectMetadata` command handler.
 *
 * @returns A function that invokes the handler with a project UUID and updated fields, resolving to
 *   the JSON-stringified updated project or `undefined` if the project was not found or the handler
 *   returns a non-string.
 * @throws If the handler was not registered during `activate()`.
 */
async function getUpdateProjectMetadataHandler(): Promise<
  (
    id: string,
    name: string | undefined,
    description: string | undefined,
    analysisLanguages: string[],
  ) => Promise<string | undefined>
> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler('interlinearizer.updateProjectMetadata');
  if (!rawHandler) throw new Error('Handler not found for interlinearizer.updateProjectMetadata');
  return async (
    id: string,
    name: string | undefined,
    description: string | undefined,
    analysisLanguages: string[],
  ): Promise<string | undefined> => {
    const result: unknown = await rawHandler(id, name, description, analysisLanguages);
    return typeof result === 'string' ? result : undefined;
  };
}

describe('main', () => {
  const mainWebViewType = 'interlinearizer.mainWebView';

  afterEach(() => deactivate());

  beforeEach(() => {
    __mockRegisterWebViewProvider.mockResolvedValue({ dispose: jest.fn() });
    __mockRegisterCommand.mockResolvedValue({ dispose: jest.fn() });
    __mockRegisterValidator.mockResolvedValue({ dispose: jest.fn() });
    __mockOpenWebView.mockResolvedValue('mock-webview-id');
    __mockSelectProject.mockResolvedValue(undefined);
    __mockGetOpenWebViewDefinition.mockResolvedValue(undefined);
    __mockOnDidOpenWebView.mockReturnValue(jest.fn());
    __mockOnDidCloseWebView.mockReturnValue(jest.fn());
    __mockNotificationsSend.mockResolvedValue('mock-notification-id');
  });

  describe('activate', () => {
    it('registers the WebView provider with a callable getWebView handler', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const raw: unknown = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      expect(isWebViewProvider(raw)).toBe(true);
    });

    it('registers the interlinearizer.openForWebView command with a callable handler', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const handler = findRegisteredHandler('interlinearizer.openForWebView');
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('registers all expected commands and subscriptions', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const registeredCommands = jest.mocked(__mockRegisterCommand).mock.calls.map((c) => c[0]);
      expect(registeredCommands).toEqual(
        expect.arrayContaining([
          'interlinearizer.openForWebView',
          'interlinearizer.createProject',
          'interlinearizer.getProject',
          'interlinearizer.saveAnalysis',
          'interlinearizer.getProjectsForSource',
          'interlinearizer.openSelectProjectModal',
          'interlinearizer.openNewProjectModal',
          'interlinearizer.openProjectInfoModal',
          'interlinearizer.updateProjectMetadata',
          'interlinearizer.deleteProject',
        ]),
      );
      expect(__mockRegisterWebViewProvider).toHaveBeenCalledWith(
        'interlinearizer.mainWebView',
        expect.any(Object),
      );
    });

    it('adds all registrations to the activation context', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(context.registrations.unsubscribers.size).toBe(14);
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

    it('propagates errors thrown by selectProject', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue(undefined);
      __mockSelectProject.mockRejectedValue(new Error('picker failed'));
      const openForWebView = await getOpenForWebViewHandler();

      await expect(openForWebView('some-webview')).rejects.toThrow('picker failed');
    });
  });

  describe('interlinearizer.createProject command', () => {
    const mockCreateProject = jest.mocked(projectStorage.createProject);
    const emptyAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const stubProject = {
      id: 'new-project-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-project',
      analysisLanguages: ['en'],
      analysis: emptyAnalysis,
    };

    it('registers the interlinearizer.createProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('delegates to projectStorage.createProject and returns the JSON-serialized project', async () => {
      mockCreateProject.mockResolvedValue(stubProject);
      const handler = await getCreateProjectHandler();

      const result = await handler('src-project', ['en']);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
        ['en'],
        undefined,
        undefined,
        undefined,
      );
      expect(result).toBe(JSON.stringify(stubProject));
    });

    it('does not show a project picker dialog', async () => {
      mockCreateProject.mockResolvedValue(stubProject);
      const handler = await getCreateProjectHandler();

      await handler('src-project', ['en']);

      expect(__mockSelectProject).not.toHaveBeenCalled();
    });

    it('logs the error, sends an error notification, and rethrows when storage fails', async () => {
      mockCreateProject.mockRejectedValue(new Error('disk full'));
      const handler = await getCreateProjectHandler();

      await expect(handler('src-project', ['en'])).rejects.toThrow('disk full');
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

  describe('interlinearizer.deleteProject command', () => {
    const mockDeleteProject = jest.mocked(projectStorage.deleteProject);

    it('registers the interlinearizer.deleteProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.deleteProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('delegates to projectStorage.deleteProject with the given ID', async () => {
      mockDeleteProject.mockResolvedValue(undefined);
      const handler = await getDeleteProjectHandler();

      await handler('to-delete-id');

      expect(mockDeleteProject).toHaveBeenCalledWith(expect.anything(), 'to-delete-id');
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockDeleteProject.mockRejectedValue(new Error('disk full'));
      const handler = await getDeleteProjectHandler();

      await expect(handler('to-delete-id')).rejects.toThrow('disk full');

      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to delete project',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  describe('interlinearizer.getProjectsForSource command', () => {
    const mockGetProjectsForSource = jest.mocked(projectStorage.getProjectsForSource);
    const emptyAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const stubProject = {
      id: 'proj-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-project',
      analysisLanguages: ['en'],
      analysis: emptyAnalysis,
    };

    it('registers the interlinearizer.getProjectsForSource command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.getProjectsForSource',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('returns a JSON string of matching projects', async () => {
      mockGetProjectsForSource.mockResolvedValue([stubProject]);
      const handler = await getProjectsForSourceHandler();

      const result = await handler('src-project');

      expect(result).toBe(JSON.stringify([stubProject]));
    });

    it('throws and logs an error when storage throws', async () => {
      mockGetProjectsForSource.mockRejectedValue(new Error('disk full'));
      const handler = await getProjectsForSourceHandler();

      await expect(handler('src-project')).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to list projects for source',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.updateProjectMetadata command', () => {
    const mockUpdateProjectMetadata = jest.mocked(projectStorage.updateProjectMetadata);
    const emptyAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const stubProject = {
      id: 'proj-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-project',
      analysisLanguages: ['en'],
      analysis: emptyAnalysis,
    };

    it('registers the interlinearizer.updateProjectMetadata command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.updateProjectMetadata',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('passes name and description to projectStorage.updateProjectMetadata', async () => {
      mockUpdateProjectMetadata.mockResolvedValue({ ...stubProject, name: 'My Name' });
      const handler = await getUpdateProjectMetadataHandler();

      await handler('proj-id', 'My Name', 'My Desc', ['en']);

      expect(mockUpdateProjectMetadata).toHaveBeenCalledWith(
        expect.anything(),
        'proj-id',
        'My Name',
        'My Desc',
        ['en'],
        undefined,
      );
    });

    it('passes analysisLanguages to projectStorage.updateProjectMetadata', async () => {
      mockUpdateProjectMetadata.mockResolvedValue({
        ...stubProject,
        analysisLanguages: ['fr', 'de'],
      });
      const handler = await getUpdateProjectMetadataHandler();

      await handler('proj-id', undefined, undefined, ['fr', 'de']);

      expect(mockUpdateProjectMetadata).toHaveBeenCalledWith(
        expect.anything(),
        'proj-id',
        undefined,
        undefined,
        ['fr', 'de'],
        undefined,
      );
    });

    it('returns undefined when the project does not exist', async () => {
      mockUpdateProjectMetadata.mockResolvedValue(undefined);
      const handler = await getUpdateProjectMetadataHandler();

      const result = await handler('missing', undefined, undefined, ['en']);

      expect(result).toBeUndefined();
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockUpdateProjectMetadata.mockRejectedValue(new Error('disk full'));
      const handler = await getUpdateProjectMetadataHandler();

      await expect(handler('proj-id', 'My Name', 'My Desc', ['en'])).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to update project metadata',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  describe('interlinearizer.getProject command', () => {
    const mockGetProject = jest.mocked(projectStorage.getProject);
    const emptyAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const stubProject = {
      id: 'proj-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-project',
      analysisLanguages: ['en'],
      analysis: emptyAnalysis,
    };

    /**
     * Activates the extension and returns a typed wrapper around the `interlinearizer.getProject`
     * command handler.
     *
     * @returns A function that invokes the handler with a project UUID and resolves to the
     *   JSON-stringified project or `undefined`.
     * @throws If the handler was not registered during `activate()`.
     */
    async function getGetProjectHandler(): Promise<(id: string) => Promise<string | undefined>> {
      const context = createTestActivationContext();
      await activate(context);
      const rawHandler = findRegisteredHandler('interlinearizer.getProject');
      if (!rawHandler) throw new Error('Handler not found for interlinearizer.getProject');
      return async (id: string): Promise<string | undefined> => {
        const result: unknown = await rawHandler(id);
        return typeof result === 'string' ? result : undefined;
      };
    }

    it('registers the interlinearizer.getProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.getProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('returns the JSON-stringified project when it exists', async () => {
      mockGetProject.mockResolvedValue(stubProject);
      const handler = await getGetProjectHandler();

      const result = await handler('proj-id');

      expect(mockGetProject).toHaveBeenCalledWith(expect.anything(), 'proj-id');
      expect(result).toBe(JSON.stringify(stubProject));
    });

    it('returns undefined when the project does not exist', async () => {
      mockGetProject.mockResolvedValue(undefined);
      const handler = await getGetProjectHandler();

      const result = await handler('missing-id');

      expect(result).toBeUndefined();
    });

    it('logs the error and rethrows when storage throws', async () => {
      mockGetProject.mockRejectedValue(new Error('disk full'));
      const handler = await getGetProjectHandler();

      await expect(handler('proj-id')).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to get project',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.saveAnalysis command', () => {
    const mockUpdateAnalysis = jest.mocked(projectStorage.updateAnalysis);
    const stubAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'In', gloss: { en: 'in' } }],
      tokenAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    /**
     * Activates the extension and returns a typed wrapper around the `interlinearizer.saveAnalysis`
     * command handler.
     *
     * @returns A function that invokes the handler with a project UUID and analysis JSON.
     * @throws If the handler was not registered during `activate()`.
     */
    async function getSaveAnalysisHandler(): Promise<
      (id: string, analysisJson: string) => Promise<void>
    > {
      const context = createTestActivationContext();
      await activate(context);
      const rawHandler = findRegisteredHandler('interlinearizer.saveAnalysis');
      if (!rawHandler) throw new Error('Handler not found for interlinearizer.saveAnalysis');
      return async (id: string, analysisJson: string): Promise<void> => {
        await rawHandler(id, analysisJson);
      };
    }

    it('registers the interlinearizer.saveAnalysis command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.saveAnalysis',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('delegates to projectStorage.updateAnalysis with the parsed analysis', async () => {
      mockUpdateAnalysis.mockResolvedValue(undefined);
      const handler = await getSaveAnalysisHandler();

      await handler('proj-id', JSON.stringify(stubAnalysis));

      expect(mockUpdateAnalysis).toHaveBeenCalledWith(expect.anything(), 'proj-id', stubAnalysis);
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockUpdateAnalysis.mockRejectedValue(new Error('disk full'));
      const handler = await getSaveAnalysisHandler();

      await expect(handler('proj-id', JSON.stringify(stubAnalysis))).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save analysis',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
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
