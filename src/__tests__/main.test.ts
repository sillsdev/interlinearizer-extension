/** @file Unit tests for the extension entry point (main.ts). */
/// <reference types="jest" />

import type { OpenWebViewOptions, SavedWebViewDefinition, WebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '@main';
import type { InterlinearizerOpenOptions } from '@main';
import * as projectStorage from '../services/projectStorage';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { createTestActivationContext, makeStubProject } from './test-helpers';

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
 * Activates the extension with a fresh test context and returns the handler registered for
 * `commandName`, cast to `T`.
 *
 * @param commandName - The fully-qualified command name to look up.
 * @returns The handler registered during `activate()`, cast to `T`.
 * @throws If the handler was not registered during `activate()`.
 */
async function activateAndGetHandler<T>(commandName: string): Promise<T> {
  const context = createTestActivationContext();
  await activate(context);
  const rawHandler = findRegisteredHandler(commandName);
  if (!rawHandler) throw new Error(`Handler not found for ${commandName}`);
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  return rawHandler as unknown as T;
}

/** Activates the extension and returns the `interlinearizer.openForWebView` handler. */
const getOpenForWebViewHandler = () =>
  activateAndGetHandler<(webViewId?: string) => Promise<string | undefined>>(
    'interlinearizer.openForWebView',
  );

/** Activates the extension and returns the `interlinearizer.createProject` handler. */
const getCreateProjectHandler = () =>
  activateAndGetHandler<
    (sourceProjectId: string, analysisLanguages: string[]) => Promise<string | undefined>
  >('interlinearizer.createProject');

/** Activates the extension and returns the `interlinearizer.deleteProject` handler. */
const getDeleteProjectHandler = () =>
  activateAndGetHandler<(id: string) => Promise<void>>('interlinearizer.deleteProject');

/** Activates the extension and returns the `interlinearizer.getProjectsForSource` handler. */
const getProjectsForSourceHandler = () =>
  activateAndGetHandler<(sourceProjectId: string) => Promise<string>>(
    'interlinearizer.getProjectsForSource',
  );

/** Activates the extension and returns the `interlinearizer.updateProjectMetadata` handler. */
const getUpdateProjectMetadataHandler = () =>
  activateAndGetHandler<
    (
      id: string,
      name: string | undefined,
      description: string | undefined,
      analysisLanguages: string[],
    ) => Promise<string | undefined>
  >('interlinearizer.updateProjectMetadata');

/** Activates the extension and returns the `interlinearizer.getProject` handler. */
const getGetProjectHandler = () =>
  activateAndGetHandler<(id: string) => Promise<string | undefined>>('interlinearizer.getProject');

/** Activates the extension and returns the `interlinearizer.saveAnalysis` handler. */
const getSaveAnalysisHandler = () =>
  activateAndGetHandler<(id: string, analysisJson: string) => Promise<void>>(
    'interlinearizer.saveAnalysis',
  );

/** Activates the extension and returns the `interlinearizer.getDraft` handler. */
const getGetDraftHandler = () =>
  activateAndGetHandler<(sourceProjectId: string) => Promise<string>>('interlinearizer.getDraft');

/** Activates the extension and returns the `interlinearizer.saveDraft` handler. */
const getSaveDraftHandler = () =>
  activateAndGetHandler<(sourceProjectId: string, draftJson: string) => Promise<void>>(
    'interlinearizer.saveDraft',
  );

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
          'interlinearizer.getDraft',
          'interlinearizer.saveDraft',
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

    it('adds every created registration to the activation context for disposal', async () => {
      const context = createTestActivationContext();

      await activate(context);

      // Every registration produced during activation must be handed to the context so the platform
      // disposes it on deactivation: the WebView provider, one per command and validator, plus the
      // two WebView lifecycle subscriptions. Deriving the count from the mock calls keeps this
      // resilient when commands or validators are added or removed.
      const expectedRegistrationCount =
        __mockRegisterWebViewProvider.mock.calls.length +
        __mockRegisterCommand.mock.calls.length +
        __mockRegisterValidator.mock.calls.length +
        __mockOnDidOpenWebView.mock.calls.length +
        __mockOnDidCloseWebView.mock.calls.length;
      expect(context.registrations.unsubscribers.size).toBe(expectedRegistrationCount);
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
    const stubProject = makeStubProject('new-project-id');

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
    const stubProject = makeStubProject('proj-id');

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
    const stubProject = makeStubProject('proj-id');

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
    const stubProject = makeStubProject('proj-id');

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
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'In', gloss: { en: 'in' } }],
    };

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

    it('logs the error, sends an error notification, and rethrows when analysisJson is not valid JSON', async () => {
      const handler = await getSaveAnalysisHandler();

      await expect(handler('proj-id', 'not-json')).rejects.toThrow(SyntaxError);
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save analysis',
        expect.any(SyntaxError),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
      expect(mockUpdateAnalysis).not.toHaveBeenCalled();
    });

    it('logs the error, sends an error notification, and rethrows when analysisJson does not conform to TextAnalysis', async () => {
      const handler = await getSaveAnalysisHandler();

      await expect(handler('proj-id', JSON.stringify({ segmentAnalyses: [] }))).rejects.toThrow(
        TypeError,
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save analysis',
        expect.any(TypeError),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
      expect(mockUpdateAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('interlinearizer.getDraft command', () => {
    const mockGetDraft = jest.mocked(projectStorage.getDraft);
    const stubDraft = emptyDraft('src-project');

    it('registers the interlinearizer.getDraft command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.getDraft',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('delegates to projectStorage.getDraft and returns the JSON-serialized draft', async () => {
      mockGetDraft.mockResolvedValue(stubDraft);
      const handler = await getGetDraftHandler();

      const result = await handler('src-project');

      expect(mockGetDraft).toHaveBeenCalledWith(expect.anything(), 'src-project');
      expect(result).toBe(JSON.stringify(stubDraft));
    });

    it('logs the error and rethrows when storage throws', async () => {
      mockGetDraft.mockRejectedValue(new Error('disk full'));
      const handler = await getGetDraftHandler();

      await expect(handler('src-project')).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to get draft',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.saveDraft command', () => {
    const mockSaveDraft = jest.mocked(projectStorage.saveDraft);
    const stubDraft = { ...emptyDraft('src-project'), analysisLanguages: ['en'], dirty: true };

    it('registers the interlinearizer.saveDraft command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraft',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('parses the JSON, validates it, and delegates to projectStorage.saveDraft', async () => {
      mockSaveDraft.mockResolvedValue(undefined);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft));

      expect(mockSaveDraft).toHaveBeenCalledWith(expect.anything(), 'src-project', stubDraft);
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockSaveDraft.mockRejectedValue(new Error('disk full'));
      const handler = await getSaveDraftHandler();

      await expect(handler('src-project', JSON.stringify(stubDraft))).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save draft',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });

    it('logs the error, sends an error notification, and rethrows when draftJson is not valid JSON', async () => {
      const handler = await getSaveDraftHandler();

      await expect(handler('src-project', 'not-json')).rejects.toThrow(SyntaxError);
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save draft',
        expect.any(SyntaxError),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
      expect(mockSaveDraft).not.toHaveBeenCalled();
    });

    it('logs the error, sends an error notification, and rethrows when draftJson does not conform to DraftProject', async () => {
      const handler = await getSaveDraftHandler();

      await expect(
        handler('src-project', JSON.stringify({ sourceProjectId: 'x' })),
      ).rejects.toThrow(TypeError);
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save draft',
        expect.any(TypeError),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
      expect(mockSaveDraft).not.toHaveBeenCalled();
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
