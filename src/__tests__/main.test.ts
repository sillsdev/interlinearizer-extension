/// <reference types="jest" />

import type { OpenWebViewOptions, SavedWebViewDefinition, WebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '@main';
import type { InterlinearizerOpenOptions } from '@main';
import type { ProjectConfig } from 'interlinearizer';
import * as bookService from '../services/bookService';
import * as hostPerf from '../services/hostPerf';
import * as projectStorage from '../services/projectStorage';
import * as pt9ImportService from '../services/pt9ImportService';
import { UnreadableBooksError } from '../types/analysis-repository';
import { emptyDraft } from '../types/empty-factories';
import { toProjectSummary } from '../types/interlinear-project-summary';
import { createTestActivationContext, makeStubProject } from './test-helpers';

jest.mock('../services/bookService');
jest.mock('../services/hostPerf');
jest.mock('../services/projectStorage');
jest.mock('../services/pt9ImportService');

/** Shape of the Jest-mocked @papi/backend default export used in these tests. */
interface PapiBackendTestMock {
  __mockRegisterWebViewProvider: jest.Mock;
  __mockRegisterCommand: jest.Mock;
  __mockOpenWebView: jest.Mock;
  __mockSelectProject: jest.Mock;
  __mockGetOpenWebViewDefinition: jest.Mock;
  __mockOnDidOpenWebView: jest.Mock;
  __mockOnDidUpdateWebView: jest.Mock;
  __mockOnDidCloseWebView: jest.Mock;
  __mockRegisterValidator: jest.Mock;
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockNotificationsSend: jest.Mock;
  __mockProjectDataProvidersGet: jest.Mock;
  __mockGetLocalizedString: jest.Mock;
  __mockCreateNetworkEventEmitterAsync: jest.Mock;
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
    '__mockOnDidUpdateWebView' in m &&
    '__mockOnDidCloseWebView' in m &&
    '__mockRegisterValidator' in m &&
    '__mockReadUserData' in m &&
    '__mockWriteUserData' in m &&
    '__mockNotificationsSend' in m &&
    '__mockProjectDataProvidersGet' in m &&
    '__mockGetLocalizedString' in m &&
    '__mockCreateNetworkEventEmitterAsync' in m &&
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
  __mockOnDidUpdateWebView,
  __mockOnDidCloseWebView,
  __mockRegisterValidator,
  __mockNotificationsSend,
  __mockProjectDataProvidersGet,
  __mockGetLocalizedString,
  __mockCreateNetworkEventEmitterAsync,
  __mockLogger,
} = papiBackendMock;

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
 * Finds the handler registered for `commandName` in the most recent `activate()` call, or
 * `undefined` when that call registered none under that name.
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

/** Activates the extension and returns the `interlinearizer.importPt9Project` handler. */
const getImportPt9ProjectHandler = () =>
  activateAndGetHandler<(sourceProjectId: string) => Promise<string>>(
    'interlinearizer.importPt9Project',
  );

/** Activates the extension and returns the `interlinearizer.createEditableCopy` handler. */
const getCreateEditableCopyHandler = () =>
  activateAndGetHandler<(id: string, name: string, description?: string) => Promise<string>>(
    'interlinearizer.createEditableCopy',
  );

/** Activates the extension and returns the `interlinearizer.getProject` handler. */
const getGetProjectHandler = () =>
  activateAndGetHandler<(id: string) => Promise<string | undefined>>('interlinearizer.getProject');

/** Activates the extension and returns the `interlinearizer.saveDraftToProject` handler. */
const getSaveDraftToProjectHandler = () =>
  activateAndGetHandler<
    (sourceProjectId: string, id: string, config?: ProjectConfig) => Promise<string | undefined>
  >('interlinearizer.saveDraftToProject');

/** Activates the extension and returns the `interlinearizer.saveDraftAsProject` handler. */
const getSaveDraftAsProjectHandler = () =>
  activateAndGetHandler<
    (
      sourceProjectId: string,
      analysisLanguages: string[],
      targetProjectId?: string,
      name?: string,
      description?: string,
    ) => Promise<string>
  >('interlinearizer.saveDraftAsProject');

/** Activates the extension and returns the `interlinearizer.getDraft` handler. */
const getGetDraftHandler = () =>
  activateAndGetHandler<(sourceProjectId: string) => Promise<string>>('interlinearizer.getDraft');

/** Activates the extension and returns the `interlinearizer.saveDraft` handler. */
const getSaveDraftHandler = () =>
  activateAndGetHandler<
    (sourceProjectId: string, draftJson: string, discardUnreadable?: boolean) => Promise<void>
  >('interlinearizer.saveDraft');

/**
 * Retrieves the callback passed to onDidOpenWebView during the most recent activate() call.
 *
 * @throws If no callback was registered (i.e. activate was not called first).
 */
function getOpenWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidOpenWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidOpenWebView callback not found');
  return (event) => cb(event);
}

/**
 * Retrieves the callback passed to onDidUpdateWebView during the most recent activate() call.
 *
 * @throws If no callback was registered (i.e. activate was not called first).
 */
function getUpdateWebViewCallback(): (event: { webView: SavedWebViewDefinition }) => void {
  const cb: unknown = __mockOnDidUpdateWebView.mock.calls[0]?.[0];
  if (!isCallable(cb)) throw new Error('onDidUpdateWebView callback not found');
  return (event) => cb(event);
}

/**
 * Retrieves the callback passed to onDidCloseWebView during the most recent activate() call.
 *
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
    __mockOnDidUpdateWebView.mockReturnValue(jest.fn());
    __mockOnDidCloseWebView.mockReturnValue(jest.fn());
    __mockNotificationsSend.mockResolvedValue('mock-notification-id');
    __mockCreateNetworkEventEmitterAsync.mockResolvedValue({ emit: jest.fn(), dispose: jest.fn() });
    jest.mocked(projectStorage.sweepPendingCleanup).mockResolvedValue(0);
  });

  describe('activate', () => {
    it('tells the WebView which notification was clicked to undo', async () => {
      const emitter = { emit: jest.fn(), dispose: jest.fn() };
      __mockCreateNetworkEventEmitterAsync.mockResolvedValue(emitter);
      const handler = await activateAndGetHandler<(notificationId: string) => Promise<void>>(
        'interlinearizer.undoFromNotification',
      );

      await handler('notification-1');

      expect(emitter.emit).toHaveBeenCalledWith({ notificationId: 'notification-1' });
    });

    describe('interlinearizer.onAnalysisChanged', () => {
      /** Gives each event its own emitter, as the platform does. */
      function emittersByEvent() {
        const emitters = new Map<string, { emit: jest.Mock; dispose: jest.Mock }>();
        __mockCreateNetworkEventEmitterAsync.mockImplementation(async (eventType: string) => {
          const emitter = { emit: jest.fn(), dispose: jest.fn() };
          emitters.set(eventType, emitter);
          return emitter;
        });
        return emitters;
      }

      it('emits the project and book of an edit to the open book', async () => {
        const emitters = emittersByEvent();
        await activate(createTestActivationContext());
        const [listener] = jest.mocked(bookService.onOpenBookTextChanged).mock.calls[0];

        listener('src-project', 'GEN');

        expect(emitters.get('interlinearizer.onAnalysisChanged')?.emit).toHaveBeenCalledWith({
          sourceProjectId: 'src-project',
          changeId: expect.any(String),
          scriptureEdit: { bookId: 'GEN' },
        });
      });

      it('gives each emitted change its own id', async () => {
        const emitters = emittersByEvent();
        await activate(createTestActivationContext());
        const [listener] = jest.mocked(bookService.onOpenBookTextChanged).mock.calls[0];

        listener('src-project', 'GEN');
        listener('src-project', 'GEN');

        const emit = emitters.get('interlinearizer.onAnalysisChanged')?.emit;
        expect(emit?.mock.calls[0][0].changeId).not.toBe(emit?.mock.calls[1][0].changeId);
      });

      it('disposes the emitter and stops listening on deactivation', async () => {
        const emitters = emittersByEvent();
        const unsubscribe = jest.fn(() => true);
        jest.mocked(bookService.onOpenBookTextChanged).mockReturnValue(unsubscribe);
        const context = createTestActivationContext();
        await activate(context);

        await context.registrations.runAllUnsubscribers();

        expect(emitters.get('interlinearizer.onAnalysisChanged')?.dispose).toHaveBeenCalled();
        expect(unsubscribe).toHaveBeenCalled();
      });
    });

    it('registers the WebView provider with a callable getWebView handler', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const raw: unknown = jest.mocked(__mockRegisterWebViewProvider).mock.calls[0]?.[1];
      expect(isWebViewProvider(raw)).toBe(true);
    });

    it('runs the pending-cleanup sweep with the execution token', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(jest.mocked(projectStorage.sweepPendingCleanup)).toHaveBeenCalledWith(
        context.executionToken,
      );
    });

    it('logs but does not fail activation when the pending-cleanup sweep rejects', async () => {
      jest
        .mocked(projectStorage.sweepPendingCleanup)
        .mockRejectedValue(new Error('sweep exploded'));
      const context = createTestActivationContext();

      await expect(activate(context)).resolves.toBeUndefined();

      // The rejection resolves on a later microtask than activate()'s synchronous body, so let the
      // fire-and-forget catch handler run before asserting it logged.
      await Promise.resolve();
      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('pending-cleanup sweep failed'),
        expect.any(Error),
      );
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
          'interlinearizer.saveDraftToProject',
          'interlinearizer.saveDraftAsProject',
          'interlinearizer.getProjectsForSource',
          'interlinearizer.getDraft',
          'interlinearizer.getTokenizedBook',
          'interlinearizer.getBookOutline',
          'interlinearizer.getSegments',
          'interlinearizer.saveDraft',
          'interlinearizer.openSelectProjectModal',
          'interlinearizer.openNewProjectModal',
          'interlinearizer.openProjectInfoModal',
          'interlinearizer.openAnalysisCatalog',
          'interlinearizer.openConcordance',
          'interlinearizer.undo',
          'interlinearizer.redo',
          'interlinearizer.undoFromNotification',
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

      // Every registration must reach the context for disposal: WebView provider, each command,
      // validator, and network event, and the two lifecycle subscriptions. Deriving the count from
      // mock calls stays resilient as commands are added or removed.
      const expectedRegistrationCount =
        __mockRegisterWebViewProvider.mock.calls.length +
        __mockRegisterCommand.mock.calls.length +
        __mockRegisterValidator.mock.calls.length +
        __mockCreateNetworkEventEmitterAsync.mock.calls.length +
        __mockOnDidOpenWebView.mock.calls.length +
        __mockOnDidUpdateWebView.mock.calls.length +
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
    /** Stubs the source project's `platform.name` setting and the tab title format. */
    function mockShortName(shortName: string | undefined): void {
      __mockProjectDataProvidersGet.mockResolvedValue({
        getSetting: jest.fn().mockResolvedValue(shortName),
      });
      __mockGetLocalizedString.mockResolvedValue('Interlinearizer: {projectName}');
    }

    const myProjectOptions: InterlinearizerOpenOptions = { projectId: 'my-project' };

    beforeEach(() => {
      mockShortName('WEB');
    });

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

    it('carries the convert offer flag into the WebView state on an explicit open', async () => {
      const context = createTestActivationContext();
      await activate(context);

      const provider = getRegisteredProvider();
      const savedWebView: SavedWebViewDefinition = {
        id: 'test-webview-id',
        webViewType: mainWebViewType,
      };

      const options: InterlinearizerOpenOptions = { offerPt9Import: true };
      const result = await provider.getWebView(savedWebView, options);

      expect(result?.state).toEqual({ offerPt9Import: true });
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

    it("titles the WebView with the project's short name", async () => {
      await activate(createTestActivationContext());

      const result = await getRegisteredProvider().getWebView(
        { id: 'test-webview-id', webViewType: mainWebViewType },
        myProjectOptions,
      );

      expect(__mockProjectDataProvidersGet).toHaveBeenCalledWith('platform.base', 'my-project');
      expect(result?.title).toBe('Interlinearizer: WEB');
    });

    it('titles the WebView with the project id when the project has no short name', async () => {
      mockShortName(undefined);
      await activate(createTestActivationContext());

      const result = await getRegisteredProvider().getWebView(
        { id: 'test-webview-id', webViewType: mainWebViewType },
        myProjectOptions,
      );

      expect(result?.title).toBe('Interlinearizer: my-project');
    });

    it('titles the WebView with the project id when the short name cannot be read', async () => {
      __mockProjectDataProvidersGet.mockRejectedValue(new Error('no such project'));
      await activate(createTestActivationContext());

      const result = await getRegisteredProvider().getWebView(
        { id: 'test-webview-id', webViewType: mainWebViewType },
        myProjectOptions,
      );

      expect(result?.title).toBe('Interlinearizer: my-project');
      expect(__mockLogger.warn).toHaveBeenCalled();
    });

    it('titles the WebView with the base title when the title format cannot be read', async () => {
      __mockGetLocalizedString.mockRejectedValue(new Error('localization unavailable'));
      await activate(createTestActivationContext());

      const result = await getRegisteredProvider().getWebView(
        { id: 'test-webview-id', webViewType: mainWebViewType },
        myProjectOptions,
      );

      expect(result?.title).toBe('Interlinearizer');
      expect(__mockLogger.warn).toHaveBeenCalled();
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

    it('passes the convert offer computed for a fresh tab into the open options', async () => {
      __mockGetOpenWebViewDefinition.mockResolvedValue({
        id: 'some-webview',
        webViewType: 'someExtension.view',
        projectId: 'project-from-webview',
      });
      jest.mocked(pt9ImportService.hasNoInterlinearizerState).mockResolvedValue(true);
      const openForWebView = await getOpenForWebViewHandler();

      await openForWebView('some-webview');

      expect(jest.mocked(pt9ImportService.hasNoInterlinearizerState)).toHaveBeenCalledWith(
        expect.anything(),
        'project-from-webview',
      );
      expect(__mockOpenWebView).toHaveBeenCalledWith(
        mainWebViewType,
        undefined,
        expect.objectContaining({ offerPt9Import: true }),
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
    it('subscribes to onDidOpenWebView, onDidUpdateWebView, and onDidCloseWebView during activation', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockOnDidOpenWebView).toHaveBeenCalledTimes(1);
      expect(__mockOnDidUpdateWebView).toHaveBeenCalledTimes(1);
      expect(__mockOnDidCloseWebView).toHaveBeenCalledTimes(1);
    });

    it('subscribes to WebView events before registering the WebView provider', async () => {
      const context = createTestActivationContext();

      await activate(context);

      const [providerOrder] = __mockRegisterWebViewProvider.mock.invocationCallOrder;
      expect(__mockOnDidUpdateWebView.mock.invocationCallOrder[0]).toBeLessThan(providerOrder);
      expect(__mockOnDidCloseWebView.mock.invocationCallOrder[0]).toBeLessThan(providerOrder);
    });

    it('leaves the WebView event subscriptions for disposal when provider registration fails', async () => {
      __mockRegisterWebViewProvider.mockRejectedValue(new Error('provider taken'));
      const unsubscribers = [jest.fn(), jest.fn(), jest.fn()];
      __mockOnDidOpenWebView.mockReturnValue(unsubscribers[0]);
      __mockOnDidUpdateWebView.mockReturnValue(unsubscribers[1]);
      __mockOnDidCloseWebView.mockReturnValue(unsubscribers[2]);
      const context = createTestActivationContext();

      await expect(activate(context)).rejects.toThrow('provider taken');
      await context.registrations.runAllUnsubscribers();

      unsubscribers.forEach((unsubscriber) => expect(unsubscriber).toHaveBeenCalled());
    });

    describe('onDidUpdateWebView callback', () => {
      it('adds a restored webView to the project map so opens reuse its tab', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);

        getUpdateWebViewCallback()({
          webView: { id: 'restored-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.objectContaining({ existingId: 'restored-tab', projectId: 'my-project' }),
        );
      });

      it("lets go of a restored project's book when its WebView closes", async () => {
        const context = createTestActivationContext();
        await activate(context);

        getUpdateWebViewCallback()({
          webView: { id: 'restored-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'restored-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        expect(bookService.closeProject).toHaveBeenCalledWith('my-project');
      });
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

      it('does not compute the convert offer when reusing an existing tab', async () => {
        __mockSelectProject.mockResolvedValue('my-project');
        const context = createTestActivationContext();
        await activate(context);
        getOpenWebViewCallback()({
          webView: { id: 'tab-from-event', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        await findRegisteredHandler('interlinearizer.openForWebView')?.();

        expect(jest.mocked(pt9ImportService.hasNoInterlinearizerState)).not.toHaveBeenCalled();
        expect(__mockOpenWebView).toHaveBeenCalledWith(
          mainWebViewType,
          undefined,
          expect.not.objectContaining({ offerPt9Import: expect.anything() }),
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

      it("lets go of the project's book when its WebView closes", async () => {
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        expect(bookService.closeProject).toHaveBeenCalledWith('my-project');
      });

      it("keeps the project's book when a different webView closes", async () => {
        const context = createTestActivationContext();
        await activate(context);

        getOpenWebViewCallback()({
          webView: { id: 'my-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });
        getCloseWebViewCallback()({
          webView: { id: 'other-tab', webViewType: mainWebViewType, projectId: 'my-project' },
        });

        expect(bookService.closeProject).not.toHaveBeenCalled();
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
    const mockGetSummaries = jest.mocked(projectStorage.getProjectSummariesForSource);
    const summary = toProjectSummary(makeStubProject('proj-id'));

    it('registers the interlinearizer.getProjectsForSource command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.getProjectsForSource',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("returns the stored summaries of the source's projects", async () => {
      mockGetSummaries.mockResolvedValue([summary]);
      const handler = await getProjectsForSourceHandler();

      const result = await handler('src-project');

      expect(mockGetSummaries).toHaveBeenCalledWith(expect.anything(), 'src-project');
      expect(JSON.parse(result)).toEqual([summary]);
    });

    it('throws and logs an error when storage throws', async () => {
      mockGetSummaries.mockRejectedValue(new Error('disk full'));
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

  describe('interlinearizer.saveDraftToProject command', () => {
    const mockSaveDraftToProject = jest.mocked(projectStorage.saveDraftToProject);

    it('registers the interlinearizer.saveDraftToProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftToProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("returns the saved project's summary, without its analysis, as JSON", async () => {
      const saved = {
        ...makeStubProject('proj-id'),
        updatedAt: '2026-06-15T09:00:00Z',
        segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      };
      mockSaveDraftToProject.mockResolvedValue(saved);
      const handler = await getSaveDraftToProjectHandler();

      const result = await handler('src-project', 'proj-id');

      // No analysis languages passed, so no config reaches storage: Save leaves it unchanged.
      expect(mockSaveDraftToProject).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
        'proj-id',
        undefined,
      );
      expect(result).toBe(JSON.stringify(toProjectSummary(saved)));
      expect(__mockNotificationsSend).not.toHaveBeenCalled();
    });

    it('tells the user which books stopped the copy and how to recover, and rethrows', async () => {
      const refusal = new UnreadableBooksError('unreadable', ['JHN', 'no book']);
      mockSaveDraftToProject.mockRejectedValue(refusal);
      __mockGetLocalizedString.mockImplementation(
        async ({ localizeKey }: { localizeKey: string }) =>
          localizeKey === '%interlinearizer_unreadable_unlinkedAnalyses%'
            ? 'analyses not linked to any book'
            : 'Not saved: {books}',
      );
      const handler = await getSaveDraftToProjectHandler();

      await expect(handler('src-project', 'proj-id')).rejects.toBe(refusal);

      expect(__mockGetLocalizedString).toHaveBeenCalledWith({
        localizeKey: '%interlinearizer_error_save_unreadableBooks%',
      });
      // Analyses linked to no book are named in words, not by their storage name.
      expect(__mockNotificationsSend).toHaveBeenCalledTimes(1);
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: 'Not saved: JHN, analyses not linked to any book',
        severity: 'error',
      });
    });

    it('logs a refusal notice that cannot be sent, and still rethrows', async () => {
      const refusal = new UnreadableBooksError('unreadable', ['JHN']);
      mockSaveDraftToProject.mockRejectedValue(refusal);
      __mockGetLocalizedString.mockRejectedValue(new Error('localization unavailable'));
      const handler = await getSaveDraftToProjectHandler();

      await expect(handler('src-project', 'proj-id')).rejects.toBe(refusal);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not report the unreadable books of a draft',
        expect.any(Error),
      );
    });

    it('forwards the config to set', async () => {
      mockSaveDraftToProject.mockResolvedValue(makeStubProject('proj-id'));
      const handler = await getSaveDraftToProjectHandler();

      await handler('src-project', 'proj-id', {
        analysisLanguages: ['fr'],
        targetProjectId: 'tgt',
      });

      expect(mockSaveDraftToProject).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
        'proj-id',
        {
          analysisLanguages: ['fr'],
          targetProjectId: 'tgt',
        },
      );
    });

    it('returns undefined when the project is gone', async () => {
      mockSaveDraftToProject.mockResolvedValue(undefined);
      const handler = await getSaveDraftToProjectHandler();

      await expect(handler('src-project', 'proj-id')).resolves.toBeUndefined();
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockSaveDraftToProject.mockRejectedValue(new Error('disk full'));
      const handler = await getSaveDraftToProjectHandler();

      await expect(handler('src-project', 'proj-id')).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save the draft to a project',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: '%interlinearizer_error_save_analysis_failed%',
        severity: 'error',
      });
    });
  });

  describe('interlinearizer.saveDraftAsProject command', () => {
    const mockSaveDraftAsNewProject = jest.mocked(projectStorage.saveDraftAsNewProject);

    it('registers the interlinearizer.saveDraftAsProject command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftAsProject',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("forwards the new project's config and returns its summary, without its analysis, as JSON", async () => {
      const created = { ...makeStubProject('new-id'), name: 'Name', targetProjectId: 'tgt' };
      mockSaveDraftAsNewProject.mockResolvedValue({ project: created, omittedBooks: [] });
      const handler = await getSaveDraftAsProjectHandler();

      const result = await handler('src-project', ['fr'], 'tgt', 'Name', 'Desc');

      expect(mockSaveDraftAsNewProject).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
        ['fr'],
        'tgt',
        'Name',
        'Desc',
      );
      expect(result).toBe(JSON.stringify(toProjectSummary(created)));
    });

    it('warns which books of the draft could not be read and were left out', async () => {
      mockSaveDraftAsNewProject.mockResolvedValue({
        project: makeStubProject('new-id'),
        omittedBooks: ['JHN'],
      });
      __mockGetLocalizedString.mockImplementation(
        async ({ localizeKey }: { localizeKey: string }) =>
          localizeKey === '%interlinearizer_unreadable_unlinkedAnalyses%'
            ? 'analyses not linked to any book'
            : 'Left out: {books}',
      );
      const handler = await getSaveDraftAsProjectHandler();

      await handler('src-project', ['en']);

      expect(__mockGetLocalizedString).toHaveBeenCalledWith({
        localizeKey: '%interlinearizer_warning_saveAs_unreadableBooksOmitted%',
      });
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: 'Left out: JHN',
        severity: 'warning',
      });
    });

    it('logs the error, sends an error notification, and rethrows when storage throws', async () => {
      mockSaveDraftAsNewProject.mockRejectedValue(new Error('disk full'));
      const handler = await getSaveDraftAsProjectHandler();

      await expect(handler('src-project', ['en'])).rejects.toThrow('disk full');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save the draft as a new project',
        expect.any(Error),
      );
      // The project was never created, so the notification says so rather than naming a save.
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: '%interlinearizer_error_create_project_failed%',
        severity: 'error',
      });
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

  describe('interlinearizer.getTokenizedBook command', () => {
    const mockGetTokenizedBook = jest.mocked(bookService.getTokenizedBook);
    const getHandler = () =>
      activateAndGetHandler<(sourceProjectId: string, bookId: string) => Promise<unknown>>(
        'interlinearizer.getTokenizedBook',
      );

    it('returns the tokenized book the service serves', async () => {
      mockGetTokenizedBook.mockResolvedValue('{"bookRef":"GEN"}');
      const handler = await getHandler();

      const result = await handler('src-project', 'GEN');

      expect(mockGetTokenizedBook).toHaveBeenCalledWith('src-project', 'GEN');
      expect(result).toBe('{"bookRef":"GEN"}');
    });

    it('logs the error and rethrows when the book cannot be tokenized', async () => {
      mockGetTokenizedBook.mockRejectedValue(new Error('bad text'));
      const handler = await getHandler();

      await expect(handler('src-project', 'GEN')).rejects.toThrow('bad text');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to tokenize book GEN of project src-project',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.getBookOutline command', () => {
    const mockGetBookOutline = jest.mocked(bookService.getBookOutline);
    const getHandler = () =>
      activateAndGetHandler<
        (sourceProjectId: string, bookId: string, segmentationJson?: string) => Promise<unknown>
      >('interlinearizer.getBookOutline');

    it('returns the outline the service serves for the boundaries asked for', async () => {
      mockGetBookOutline.mockResolvedValue('{"bookRef":"GEN"}');
      const handler = await getHandler();

      const result = await handler('src-project', 'GEN', '{"removedVerseStarts":[]}');

      expect(mockGetBookOutline).toHaveBeenCalledWith(
        'src-project',
        'GEN',
        '{"removedVerseStarts":[]}',
      );
      expect(result).toBe('{"bookRef":"GEN"}');
    });

    it('logs the error and rethrows when the book cannot be outlined', async () => {
      mockGetBookOutline.mockRejectedValue(new Error('bad text'));
      const handler = await getHandler();

      await expect(handler('src-project', 'GEN')).rejects.toThrow('bad text');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to outline book GEN of project src-project',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.getSegments command', () => {
    const mockGetSegments = jest.mocked(bookService.getSegments);
    const getHandler = () =>
      activateAndGetHandler<
        (
          sourceProjectId: string,
          bookId: string,
          start: number,
          end: number,
          segmentationJson?: string,
        ) => Promise<unknown>
      >('interlinearizer.getSegments');

    it('returns the page the service serves for the range and boundaries asked for', async () => {
      mockGetSegments.mockResolvedValue('{"start":32}');
      const handler = await getHandler();

      const result = await handler('src-project', 'GEN', 32, 64, '{"removedVerseStarts":[]}');

      expect(mockGetSegments).toHaveBeenCalledWith(
        'src-project',
        'GEN',
        32,
        64,
        '{"removedVerseStarts":[]}',
      );
      expect(result).toBe('{"start":32}');
    });

    it('logs the error and rethrows when the segments cannot be served', async () => {
      mockGetSegments.mockRejectedValue(new Error('bad text'));
      const handler = await getHandler();

      await expect(handler('src-project', 'GEN', 0, 32)).rejects.toThrow('bad text');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to serve segments 0-32 of book GEN of project src-project',
        expect.any(Error),
      );
    });
  });

  describe('interlinearizer.setPerfMarks command', () => {
    it("turns the host's timing entries on or off as asked", async () => {
      const handler = await activateAndGetHandler<(enabled: boolean) => Promise<void>>(
        'interlinearizer.setPerfMarks',
      );

      await handler(true);

      expect(hostPerf.setHostPerfMarks).toHaveBeenCalledWith(true);
    });
  });

  describe('interlinearizer.readPerf command', () => {
    const mockReadHostPerf = jest.mocked(hostPerf.readHostPerf);

    it("returns the host's reading as JSON", async () => {
      const reading = { entries: [{ name: 'getDraft', duration: 12, detail: undefined }], pid: 42 };
      mockReadHostPerf.mockReturnValue(reading);
      const handler = await activateAndGetHandler<() => Promise<string | undefined>>(
        'interlinearizer.readPerf',
      );

      await expect(handler()).resolves.toBe(JSON.stringify(reading));
    });

    it("returns nothing while the host's timing entries are off", async () => {
      mockReadHostPerf.mockReturnValue(undefined);
      const handler = await activateAndGetHandler<() => Promise<string | undefined>>(
        'interlinearizer.readPerf',
      );

      await expect(handler()).resolves.toBeUndefined();
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

      expect(mockSaveDraft).toHaveBeenCalledWith(expect.anything(), 'src-project', stubDraft, {
        discardUnreadable: false,
      });
    });

    it('discards unreadable analysis only for a draft started over', async () => {
      mockSaveDraft.mockResolvedValue(undefined);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft), true);

      expect(mockSaveDraft).toHaveBeenCalledWith(expect.anything(), 'src-project', stubDraft, {
        discardUnreadable: true,
      });
    });

    it('tells the user once which books a refused write was for, until a write succeeds', async () => {
      __mockGetLocalizedString.mockResolvedValue('Changes lost: {books}');
      const handler = await getSaveDraftHandler();
      const refusal = new UnreadableBooksError('unreadable', ['JHN']);
      mockSaveDraft.mockRejectedValueOnce(refusal).mockRejectedValueOnce(refusal);

      await expect(handler('src-project', JSON.stringify(stubDraft))).rejects.toBe(refusal);
      await expect(handler('src-project', JSON.stringify(stubDraft))).rejects.toBe(refusal);
      expect(__mockNotificationsSend).toHaveBeenCalledTimes(1);
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: 'Changes lost: JHN',
        severity: 'error',
      });

      mockSaveDraft.mockResolvedValueOnce(undefined).mockRejectedValueOnce(refusal);
      await handler('src-project', JSON.stringify(stubDraft));
      await expect(handler('src-project', JSON.stringify(stubDraft))).rejects.toBe(refusal);
      expect(__mockNotificationsSend).toHaveBeenCalledTimes(2);
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

    it('rejects a draft whose model version is not a number before it reaches storage', async () => {
      const handler = await getSaveDraftHandler();

      await expect(
        handler('src-project', JSON.stringify({ ...stubDraft, modelVersion: 'one' })),
      ).rejects.toThrow(TypeError);
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

    it('lets go of every book kept', async () => {
      await deactivate();

      expect(bookService.closeAllProjects).toHaveBeenCalled();
    });

    it('logs deactivation', async () => {
      await deactivate();

      expect(__mockLogger.debug).toHaveBeenCalledWith('Interlinearizer extension is deactivating!');
    });
  });

  describe('interlinearizer.importPt9Project command', () => {
    const mockImport = jest.mocked(pt9ImportService.importPt9Project);

    it('registers the interlinearizer.importPt9Project command with no caller timeout', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        expect.any(Function),
        expect.any(Object),
        { timeoutMilliseconds: 0 },
      );
    });

    it('returns the import result as JSON without a warning when data was imported', async () => {
      mockImport.mockResolvedValue({ outcome: 'imported', projectId: 'import-id' });
      const handler = await getImportPt9ProjectHandler();

      const result = await handler('src-project');

      expect(mockImport).toHaveBeenCalledWith(expect.anything(), 'src-project');
      expect(JSON.parse(result)).toStrictEqual({ outcome: 'imported', projectId: 'import-id' });
      expect(__mockNotificationsSend).not.toHaveBeenCalled();
    });

    it('sends a warning notification when the stored import was kept', async () => {
      mockImport.mockResolvedValue({ outcome: 'staleKept', projectId: 'import-id' });
      const handler = await getImportPt9ProjectHandler();

      const result = await handler('src-project');

      expect(JSON.parse(result)).toStrictEqual({ outcome: 'staleKept', projectId: 'import-id' });
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: '%interlinearizer_warning_pt9Import_sourceEmpty%',
        severity: 'warning',
      });
    });

    it('logs the error, sends an error notification, and rethrows when the import fails', async () => {
      mockImport.mockRejectedValue(new Error('nothing to import'));
      const handler = await getImportPt9ProjectHandler();

      await expect(handler('src-project')).rejects.toThrow('nothing to import');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to import Paratext 9 interlinear data',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: '%interlinearizer_error_pt9Import_failed%',
        severity: 'error',
      });
    });
  });

  describe('interlinearizer.createEditableCopy command', () => {
    const mockCopy = jest.mocked(projectStorage.createEditableCopy);

    it('registers the interlinearizer.createEditableCopy command', async () => {
      const context = createTestActivationContext();

      await activate(context);

      expect(__mockRegisterCommand).toHaveBeenCalledWith(
        'interlinearizer.createEditableCopy',
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('returns the created copy as JSON', async () => {
      const copy = { ...makeStubProject('copy-id'), name: 'My Copy' };
      mockCopy.mockResolvedValue(copy);
      const handler = await getCreateEditableCopyHandler();

      const result = await handler('import-id', 'My Copy', 'my description');

      expect(mockCopy).toHaveBeenCalledWith(
        expect.anything(),
        'import-id',
        'My Copy',
        'my description',
      );
      expect(JSON.parse(result)).toStrictEqual(copy);
    });

    it('logs the error, sends an error notification, and rethrows when the copy fails', async () => {
      mockCopy.mockRejectedValue(new Error('not a Paratext 9 import'));
      const handler = await getCreateEditableCopyHandler();

      await expect(handler('plain-id', 'My Copy')).rejects.toThrow('not a Paratext 9 import');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to create an editable copy',
        expect.any(Error),
      );
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: '%interlinearizer_error_createEditableCopy_failed%',
        severity: 'error',
      });
    });
  });
});
