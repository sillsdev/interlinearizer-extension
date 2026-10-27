/// <reference types="jest" />

import type { OpenWebViewOptions, SavedWebViewDefinition, WebViewDefinition } from '@papi/core';
import papiBackendMock from '@papi/backend';
import { activate, deactivate } from '@main';
import type { InterlinearizerOpenOptions } from '@main';
import type {
  DraftProject,
  PhraseAnalysisLink,
  ProjectConfig,
  SegmentationDelta,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import { AnalysisSessions } from '../services/analysisSessions';
import { ApprovalRuleError } from '../services/commands/approvalRule';
import * as bookService from '../services/bookService';
import { DraftRepository } from '../services/draftRepository';
import * as hostPerf from '../services/hostPerf';
import * as projectStorage from '../services/projectStorage';
import * as pt9ImportService from '../services/pt9ImportService';
import { type AnalysisRepository, UnreadableBooksError } from '../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { scopeRecordOf } from '../utils/change-set';
import { toProjectSummary } from '../types/interlinear-project-summary';
import {
  createTestActivationContext,
  FIXTURE_STAMPS,
  makeStubProject,
  makeVerseBook,
  memoryStorage,
  silentLogger,
} from './test-helpers';

jest.mock('../services/bookService');
jest.mock('../services/csharpHost');
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
  __mockSettingsGet: jest.Mock;
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
    '__mockSettingsGet' in m &&
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
  __mockSettingsGet,
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

      it('emits the project and book of an edit to a watched book', async () => {
        const emitters = emittersByEvent();
        await activate(createTestActivationContext());
        const [listener] = jest.mocked(bookService.onBookTextChanged).mock.calls[0];

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
        const [listener] = jest.mocked(bookService.onBookTextChanged).mock.calls[0];

        listener('src-project', 'GEN');
        listener('src-project', 'GEN');

        const emit = emitters.get('interlinearizer.onAnalysisChanged')?.emit;
        expect(emit?.mock.calls[0][0].changeId).not.toBe(emit?.mock.calls[1][0].changeId);
      });

      it('disposes the emitter and stops listening on deactivation', async () => {
        const emitters = emittersByEvent();
        const unsubscribe = jest.fn(() => true);
        jest.mocked(bookService.onBookTextChanged).mockReturnValue(unsubscribe);
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
          'interlinearizer.getTextReadStatus',
          'interlinearizer.saveDraft',
          'interlinearizer.openSession',
          'interlinearizer.closeSession',
          'interlinearizer.setAnalysisLanguage',
          'interlinearizer.undoEdit',
          'interlinearizer.redoEdit',
          'interlinearizer.checkIndexes',
          'interlinearizer.writeGloss',
          'interlinearizer.approveAnalysisForToken',
          'interlinearizer.discardStaleAnalysis',
          'interlinearizer.reapplyStaleAnalysis',
          'interlinearizer.keepStaleFreeTranslation',
          'interlinearizer.discardStaleFreeTranslation',
          'interlinearizer.createPhrase',
          'interlinearizer.updatePhrase',
          'interlinearizer.deletePhrase',
          'interlinearizer.mergePhrases',
          'interlinearizer.writePhraseGloss',
          'interlinearizer.approvePhrase',
          'interlinearizer.splitPhrase',
          'interlinearizer.writeSegmentFreeTranslation',
          'interlinearizer.mergeSegments',
          'interlinearizer.splitSegment',
          'interlinearizer.moveBoundary',
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
      expect(result).toBe(JSON.stringify({ project: toProjectSummary(created), omittedBooks: [] }));
    });

    it('returns the books the new project left out', async () => {
      mockSaveDraftAsNewProject.mockResolvedValue({
        project: makeStubProject('new-id'),
        omittedBooks: ['JHN'],
      });
      const handler = await getSaveDraftAsProjectHandler();

      const result = await handler('src-project', ['en']);

      expect(JSON.parse(result)).toHaveProperty('omittedBooks', ['JHN']);
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
      mockGetDraft.mockResolvedValue({ draft: stubDraft, unreadableBooks: [] });
      const handler = await getGetDraftHandler();

      const result = await handler('src-project');

      expect(mockGetDraft).toHaveBeenCalledWith(expect.anything(), 'src-project');
      expect(result).toBe(JSON.stringify(stubDraft));
    });

    it('warns which books of the draft could not be read and still returns the draft', async () => {
      mockGetDraft.mockResolvedValue({ draft: stubDraft, unreadableBooks: ['JHN'] });
      __mockGetLocalizedString.mockResolvedValue('Opened without: {books}');
      const handler = await getGetDraftHandler();

      const result = await handler('src-project');

      expect(__mockGetLocalizedString).toHaveBeenCalledWith({
        localizeKey: '%interlinearizer_warning_loadDraft_unreadableBooks%',
      });
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: 'Opened without: JHN',
        severity: 'warning',
      });
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

  describe('interlinearizer.getTextReadStatus command', () => {
    const mockGetTextReadStatus = jest.mocked(bookService.getTextReadStatus);
    const getHandler = () =>
      activateAndGetHandler<(sourceProjectId: string) => Promise<unknown>>(
        'interlinearizer.getTextReadStatus',
      );

    it('returns the status the service reports for the project', async () => {
      mockGetTextReadStatus.mockResolvedValue('{"booksRead":1}');
      const handler = await getHandler();

      const result = await handler('src-project');

      expect(mockGetTextReadStatus).toHaveBeenCalledWith('src-project');
      expect(result).toBe('{"booksRead":1}');
    });

    it('logs the error and rethrows when the books cannot be listed', async () => {
      mockGetTextReadStatus.mockRejectedValue(new Error('offline'));
      const handler = await getHandler();

      await expect(handler('src-project')).rejects.toThrow('offline');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to read the text of project src-project',
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
      mockSaveDraft.mockResolvedValue([]);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft));

      expect(mockSaveDraft).toHaveBeenCalledWith(expect.anything(), 'src-project', stubDraft, {
        discardUnreadable: false,
      });
    });

    it('discards unreadable analysis only for a draft started over', async () => {
      mockSaveDraft.mockResolvedValue([]);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft), true);

      expect(mockSaveDraft).toHaveBeenCalledWith(expect.anything(), 'src-project', stubDraft, {
        discardUnreadable: true,
      });
    });

    it('sends nothing for a write that left no book out', async () => {
      mockSaveDraft.mockResolvedValue([]);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft));

      expect(__mockNotificationsSend).not.toHaveBeenCalled();
    });

    it('tells the user which books a write left out, and resolves', async () => {
      __mockGetLocalizedString.mockResolvedValue('Changes lost: {books}');
      mockSaveDraft.mockResolvedValue(['JHN']);
      const handler = await getSaveDraftHandler();

      await expect(handler('src-project', JSON.stringify(stubDraft))).resolves.toBeUndefined();

      expect(__mockGetLocalizedString).toHaveBeenCalledWith({
        localizeKey: '%interlinearizer_error_saveDraft_unreadableBooks%',
      });
      expect(__mockNotificationsSend).toHaveBeenCalledWith({
        message: 'Changes lost: JHN',
        severity: 'error',
      });
    });

    it('tells the user once while later writes leave out the same books', async () => {
      __mockGetLocalizedString.mockResolvedValue('Changes lost: {books}');
      mockSaveDraft.mockResolvedValue(['JHN']);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft));
      await handler('src-project', JSON.stringify(stubDraft));

      expect(__mockNotificationsSend).toHaveBeenCalledTimes(1);
    });

    it('tells the user again once a write has left no book out', async () => {
      __mockGetLocalizedString.mockResolvedValue('Changes lost: {books}');
      mockSaveDraft
        .mockResolvedValueOnce(['JHN'])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['JHN']);
      const handler = await getSaveDraftHandler();

      await handler('src-project', JSON.stringify(stubDraft));
      await handler('src-project', JSON.stringify(stubDraft));
      await handler('src-project', JSON.stringify(stubDraft));

      expect(__mockNotificationsSend).toHaveBeenCalledTimes(2);
    });

    it('tells the user again once the draft is loaded again', async () => {
      __mockGetLocalizedString.mockResolvedValue('Changes lost: {books}');
      mockSaveDraft.mockResolvedValue(['JHN']);
      jest
        .mocked(projectStorage.getDraft)
        .mockResolvedValue({ draft: stubDraft, unreadableBooks: [] });
      const saveDraft = await getSaveDraftHandler();
      const getDraft = findRegisteredHandler('interlinearizer.getDraft');

      await saveDraft('src-project', JSON.stringify(stubDraft));
      await getDraft?.('src-project');
      await saveDraft('src-project', JSON.stringify(stubDraft));

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

  describe('session commands', () => {
    /** A repository handing out `draft`, as storage would open one. */
    function stubRepository(draft: DraftProject, readOnly = false): AnalysisRepository {
      const noLinks = { tokenAnalysisLinks: [], phraseAnalysisLinks: [], segmentAnalysisLinks: [] };
      return {
        capabilities: { readOnly },
        exportAll: async () => ({ draft, unreadableBooks: [] }),
        exportForCopy: async () => ({ draft, unreadableBooks: [] }),
        replaceAll: async () => [],
        markClean: async () => {},
        apply: async (changes) => ({ inverse: changes }),
        getTokenAnalyses: async () => [],
        getPhraseAnalyses: async () => [],
        getSegmentAnalyses: async () => [],
        getPhraseAnalysisLinks: async () => [],
        findLinksByToken: async () => noLinks,
        findLinksBySegment: async () => [],
        findLinksToAnalyses: async () => noLinks,
        findLinksInBooks: async () => noLinks,
        findTokenAnalysesByForm: async () => [],
        findPhraseAnalysesByForm: async () => [],
        checkIndexes: async () => [
          { index: 'tokenAnalyses', key: 'ta-1', missing: ['ta-1'], extra: [] },
        ],
        getScope: async () => scopeRecordOf(draft),
      };
    }

    /** Activates the extension and returns the session commands' handlers. */
    async function activateSessionCommands() {
      await activate(createTestActivationContext());
      const handler = <T>(commandName: string): T => {
        const raw = findRegisteredHandler(commandName);
        if (!raw) throw new Error(`Handler not found for ${commandName}`);
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        return raw as unknown as T;
      };
      return {
        openSession: handler<
          (sourceProjectId: string, interlinearProjectId?: string) => Promise<string>
        >('interlinearizer.openSession'),
        closeSession: handler<(sessionId: string) => Promise<void>>('interlinearizer.closeSession'),
        setAnalysisLanguage: handler<
          (sessionId: string, analysisLanguage: string) => Promise<void>
        >('interlinearizer.setAnalysisLanguage'),
        undoEdit: handler<(sessionId: string) => Promise<string | undefined>>(
          'interlinearizer.undoEdit',
        ),
        redoEdit: handler<(sessionId: string) => Promise<string | undefined>>(
          'interlinearizer.redoEdit',
        ),
        checkIndexes: handler<(sessionId: string) => Promise<string>>(
          'interlinearizer.checkIndexes',
        ),
        writeGloss: handler<
          (
            sessionId: string,
            tokenRef: string,
            surfaceText: string,
            value: string,
          ) => Promise<string>
        >('interlinearizer.writeGloss'),
        approveAnalysisForToken: handler<
          (
            sessionId: string,
            tokenRef: string,
            surfaceText: string,
            analysisId: string,
          ) => Promise<string>
        >('interlinearizer.approveAnalysisForToken'),
        discardStaleAnalysis: handler<
          (sessionId: string, analysisId: string, tokenRef: string) => Promise<string>
        >('interlinearizer.discardStaleAnalysis'),
        reapplyStaleAnalysis: handler<
          (
            sessionId: string,
            analysisId: string,
            staleTokenRef: string,
            tokenRef: string,
            surfaceText: string,
          ) => Promise<string>
        >('interlinearizer.reapplyStaleAnalysis'),
        keepStaleFreeTranslation: handler<
          (
            sessionId: string,
            analysisId: string,
            segmentId: string,
            surfaceText: string,
          ) => Promise<string>
        >('interlinearizer.keepStaleFreeTranslation'),
        discardStaleFreeTranslation: handler<
          (sessionId: string, analysisId: string) => Promise<string>
        >('interlinearizer.discardStaleFreeTranslation'),
        createPhrase: handler<(sessionId: string, tokens: TokenSnapshot[]) => Promise<string>>(
          'interlinearizer.createPhrase',
        ),
        updatePhrase: handler<
          (sessionId: string, phraseId: string, tokens: TokenSnapshot[]) => Promise<string>
        >('interlinearizer.updatePhrase'),
        deletePhrase: handler<(sessionId: string, phraseId: string) => Promise<string>>(
          'interlinearizer.deletePhrase',
        ),
        mergePhrases: handler<
          (
            sessionId: string,
            targetPhraseId: string,
            tokens: TokenSnapshot[],
            absorbedPhraseId?: string | null,
          ) => Promise<string>
        >('interlinearizer.mergePhrases'),
        writePhraseGloss: handler<
          (sessionId: string, phraseId: string, value: string) => Promise<string>
        >('interlinearizer.writePhraseGloss'),
        approvePhrase: handler<(sessionId: string, phraseId: string) => Promise<string>>(
          'interlinearizer.approvePhrase',
        ),
        splitPhrase: handler<
          (sessionId: string, phraseId: string, splitAfterTokenRef: string) => Promise<string>
        >('interlinearizer.splitPhrase'),
        writeSegmentFreeTranslation: handler<
          (
            sessionId: string,
            segmentId: string,
            surfaceText: string,
            value: string,
            adoptStaleAnalysisId?: string | null,
          ) => Promise<string>
        >('interlinearizer.writeSegmentFreeTranslation'),
        mergeSegments: handler<
          (sessionId: string, secondSegmentStartRef: string) => Promise<string>
        >('interlinearizer.mergeSegments'),
        splitSegment: handler<(sessionId: string, tokenRef: string) => Promise<string>>(
          'interlinearizer.splitSegment',
        ),
        moveBoundary: handler<
          (sessionId: string, fromRef: string, toRef: string) => Promise<string>
        >('interlinearizer.moveBoundary'),
      };
    }

    /** Stores a draft of `src-project` holding `analysis` and `segmentation`, for sessions to open. */
    async function storeDraftHolding(
      analysis: Partial<TextAnalysis>,
      segmentation?: SegmentationDelta,
    ): Promise<void> {
      const repository = new DraftRepository(
        memoryStorage().storage,
        'src-project',
        silentLogger(),
      );
      await repository.replaceAll({
        ...emptyDraft('src-project'),
        analysisLanguages: ['en'],
        analysis: { ...emptyAnalysis(), ...analysis },
        ...(segmentation && { segmentation }),
      });
      jest.mocked(projectStorage.openDraftRepository).mockReturnValue(repository);
    }

    const staleToken = {
      tokenAnalyses: [{ id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
      tokenAnalysisLinks: [
        {
          id: 'tl-stale',
          analysisId: 'ta-in',
          ...FIXTURE_STAMPS,
          status: 'stale' as const,
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
        },
      ],
    };

    const staleTranslation = {
      segmentAnalyses: [
        { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning', freeTranslation: {} },
      ],
      segmentAnalysisLinks: [
        {
          id: 'sl-stale',
          analysisId: 'sa-1',
          ...FIXTURE_STAMPS,
          status: 'stale' as const,
          segmentId: 'GEN 1:1-2',
        },
      ],
    };

    /** Two verses of Genesis, standing in for the source project's text. */
    const VERSE_BOOK = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning God' },
      { sid: 'GEN 1:2', text: 'And the earth' },
    ]);

    beforeEach(() => {
      jest
        .mocked(projectStorage.openDraftRepository)
        .mockReturnValue(
          stubRepository({ ...emptyDraft('src-project'), analysisLanguages: ['en'] }),
        );
      __mockSettingsGet.mockResolvedValue(['en']);
      jest.mocked(bookService.getVerseBook).mockResolvedValue(VERSE_BOOK);
      jest.mocked(bookService.getBookSegments).mockResolvedValue(VERSE_BOOK.segments);
    });

    it("opens a session on the source project's draft", async () => {
      const { openSession } = await activateSessionCommands();

      const opened = JSON.parse(await openSession('src-project'));

      expect(opened).toStrictEqual({
        sessionId: expect.any(String),
        readOnly: false,
        hasFreeTranslations: false,
      });
      expect(projectStorage.openDraftRepository).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
      );
    });

    it("opens a Paratext 9 import's session read-only, found among the source's projects", async () => {
      const imported = {
        ...makeStubProject('import-id'),
        pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
      };
      jest
        .mocked(projectStorage.getProjectSummariesForSource)
        .mockResolvedValue([
          toProjectSummary(makeStubProject('other-id')),
          toProjectSummary(imported),
        ]);
      jest
        .mocked(projectStorage.openPt9ImportRepository)
        .mockReturnValue(stubRepository(emptyDraft('src-project'), true));
      const { openSession } = await activateSessionCommands();

      const opened = JSON.parse(await openSession('src-project', 'import-id'));

      expect(opened.readOnly).toBe(true);
      expect(projectStorage.getProjectSummariesForSource).toHaveBeenCalledWith(
        expect.anything(),
        'src-project',
      );
      expect(projectStorage.openPt9ImportRepository).toHaveBeenCalledWith(
        expect.anything(),
        'import-id',
      );
    });

    it('reads the interface languages for a draft that lists no analysis language', async () => {
      jest
        .mocked(projectStorage.openDraftRepository)
        .mockReturnValue(stubRepository(emptyDraft('src-project')));
      __mockSettingsGet.mockResolvedValue(['fr']);
      const { openSession } = await activateSessionCommands();

      await openSession('src-project');

      expect(__mockSettingsGet).toHaveBeenCalledWith('platform.interfaceLanguage');
    });

    it('logs the error and rethrows when the session cannot open', async () => {
      jest.mocked(projectStorage.getProjectSummariesForSource).mockResolvedValue([]);
      const { openSession } = await activateSessionCommands();

      await expect(openSession('src-project', 'missing')).rejects.toThrow(
        'has no interlinear project missing',
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to open a session on project src-project',
        expect.any(Error),
      );
    });

    it("closes a session, releasing its draft's repository", async () => {
      const { openSession, closeSession } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await closeSession(sessionId);

      expect(projectStorage.releaseDraftRepository).toHaveBeenCalledWith('src-project');
    });

    it('sets the analysis language of an open session', async () => {
      const { openSession, setAnalysisLanguage } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(setAnalysisLanguage(sessionId, 'fr')).resolves.toBeUndefined();
    });

    it('logs the error and rethrows when setting the language of a session that is not open', async () => {
      const { setAnalysisLanguage } = await activateSessionCommands();

      await expect(setAnalysisLanguage('not-a-session', 'fr')).rejects.toThrow(
        'no session not-a-session is open',
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to set the analysis language of session not-a-session',
        expect.any(Error),
      );
    });

    it('replies to an undo with the changes it applied', async () => {
      const reverted = { intent: 'writeGloss', tokenAnalyses: { puts: [], deletes: ['ta-1'] } };
      jest.spyOn(AnalysisSessions.prototype, 'undo').mockResolvedValue(reverted);
      const { undoEdit } = await activateSessionCommands();

      await expect(undoEdit('session-id')).resolves.toBe(JSON.stringify(reverted));
      expect(AnalysisSessions.prototype.undo).toHaveBeenCalledWith('session-id');
    });

    it('replies to an undo with nothing when there is no edit to undo', async () => {
      const { openSession, undoEdit } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(undoEdit(sessionId)).resolves.toBeUndefined();
    });

    it('logs the error and rethrows when an undo fails', async () => {
      const { undoEdit } = await activateSessionCommands();

      await expect(undoEdit('not-a-session')).rejects.toThrow('no session not-a-session is open');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to undo an edit in session not-a-session',
        expect.any(Error),
      );
    });

    it('replies to a redo with the changes it applied', async () => {
      const remade = { intent: 'writeGloss', tokenAnalyses: { puts: [], deletes: ['ta-1'] } };
      jest.spyOn(AnalysisSessions.prototype, 'redo').mockResolvedValue(remade);
      const { redoEdit } = await activateSessionCommands();

      await expect(redoEdit('session-id')).resolves.toBe(JSON.stringify(remade));
      expect(AnalysisSessions.prototype.redo).toHaveBeenCalledWith('session-id');
    });

    it('replies to a redo with nothing when there is no undone edit', async () => {
      const { openSession, redoEdit } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(redoEdit(sessionId)).resolves.toBeUndefined();
    });

    it('logs the error and rethrows when a redo fails', async () => {
      const { redoEdit } = await activateSessionCommands();

      await expect(redoEdit('not-a-session')).rejects.toThrow('no session not-a-session is open');
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to redo an edit in session not-a-session',
        expect.any(Error),
      );
    });

    it("replies with the differences the session's repository finds in its indexes", async () => {
      const { openSession, checkIndexes } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(checkIndexes(sessionId)).resolves.toBe(
        JSON.stringify([{ index: 'tokenAnalyses', key: 'ta-1', missing: ['ta-1'], extra: [] }]),
      );
    });

    it('logs the error and rethrows when the indexes cannot be checked', async () => {
      const { checkIndexes } = await activateSessionCommands();

      await expect(checkIndexes('not-a-session')).rejects.toThrow(
        'no session not-a-session is open',
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to check the indexes of session not-a-session',
        expect.any(Error),
      );
    });

    it("writes a token's gloss in the session's language, replying with the changes", async () => {
      const { openSession, setAnalysisLanguage, writeGloss } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));
      await setAnalysisLanguage(sessionId, 'fr');

      const changes = JSON.parse(await writeGloss(sessionId, 'GEN 1:1:0', 'In', 'au'));

      expect(changes).toMatchObject({
        intent: 'writeGloss',
        tokenAnalyses: { puts: [{ surfaceText: 'In', gloss: { fr: 'au' } }], deletes: [] },
        tokenAnalysisLinks: {
          puts: [{ status: 'approved', token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' } }],
          deletes: [],
        },
      });
    });

    it('logs the error and rethrows when an edit fails', async () => {
      const { writeGloss } = await activateSessionCommands();

      await expect(writeGloss('not-a-session', 'GEN 1:1:0', 'In', 'at')).rejects.toThrow(
        'no session not-a-session is open',
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to writeGloss in session not-a-session',
        expect.any(Error),
      );
    });

    it('approves an analysis for a token, replying with the changes', async () => {
      const { openSession, approveAnalysisForToken } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(
        approveAnalysisForToken(sessionId, 'GEN 1:1:0', 'In', 'ta-unknown').then(JSON.parse),
      ).resolves.toStrictEqual({ intent: 'approveAnalysisForToken' });
    });

    it('discards the place an analysis went stale at, replying with the changes', async () => {
      await storeDraftHolding(staleToken);
      const { openSession, discardStaleAnalysis } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(
        discardStaleAnalysis(sessionId, 'ta-in', 'GEN 1:1:0').then(JSON.parse),
      ).resolves.toStrictEqual({
        intent: 'discardStaleAnalysis',
        tokenAnalyses: { puts: [], deletes: ['ta-in'] },
        tokenAnalysisLinks: { puts: [], deletes: ['tl-stale'] },
      });
    });

    it('reapplies a stale analysis on a token, replying with the changes', async () => {
      await storeDraftHolding(staleToken);
      const { openSession, reapplyStaleAnalysis } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      const changes = JSON.parse(
        await reapplyStaleAnalysis(sessionId, 'ta-in', 'GEN 1:1:0', 'GEN 1:2:0', 'In'),
      );

      expect(changes).toMatchObject({
        intent: 'reapplyStaleAnalysis',
        tokenAnalysisLinks: {
          puts: [
            {
              analysisId: 'ta-in',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'In' },
            },
          ],
          deletes: ['tl-stale'],
        },
      });
    });

    it('keeps a stale free translation for a segment, replying with the changes', async () => {
      await storeDraftHolding(staleTranslation);
      const { openSession, keepStaleFreeTranslation } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      const changes = JSON.parse(
        await keepStaleFreeTranslation(sessionId, 'sa-1', 'GEN 1:1', 'In the start'),
      );

      expect(changes).toMatchObject({
        intent: 'keepStaleFreeTranslation',
        segmentAnalyses: { puts: [{ id: 'sa-1', surfaceText: 'In the start' }], deletes: [] },
        segmentAnalysisLinks: {
          puts: [{ id: 'sl-stale', status: 'approved', segmentId: 'GEN 1:1' }],
          deletes: [],
        },
      });
    });

    it('discards a stale free translation, replying with the changes', async () => {
      await storeDraftHolding(staleTranslation);
      const { openSession, discardStaleFreeTranslation } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(
        discardStaleFreeTranslation(sessionId, 'sa-1').then(JSON.parse),
      ).resolves.toStrictEqual({
        intent: 'discardStaleFreeTranslation',
        segmentAnalyses: { puts: [], deletes: ['sa-1'] },
        segmentAnalysisLinks: { puts: [], deletes: ['sl-stale'] },
      });
    });

    const inThe: TokenSnapshot[] = [
      { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
      { tokenRef: 'GEN 1:1:3', surfaceText: 'the' },
    ];

    const beginningGod: TokenSnapshot[] = [
      { tokenRef: 'GEN 1:1:7', surfaceText: 'beginning' },
      { tokenRef: 'GEN 1:1:17', surfaceText: 'God' },
    ];

    it('creates a phrase, replying with the changes', async () => {
      const { openSession, createPhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      const changes = JSON.parse(await createPhrase(sessionId, inThe));

      expect(changes).toMatchObject({
        intent: 'createPhrase',
        phraseAnalyses: { puts: [{ surfaceText: 'In the' }], deletes: [] },
        phraseAnalysisLinks: { puts: [{ status: 'approved', tokens: inThe }], deletes: [] },
      });
      expect(bookService.getBookSegments).toHaveBeenCalledWith('src-project', 'GEN', undefined);
    });

    it("checks a phrase against the segments the draft's boundaries in its book make", async () => {
      await storeDraftHolding(
        {},
        { removedVerseStarts: ['GEN 1:2:0', 'EXO 1:2:0'], addedStarts: [] },
      );
      const { openSession, createPhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await createPhrase(sessionId, inThe);

      expect(bookService.getBookSegments).toHaveBeenCalledWith(
        'src-project',
        'GEN',
        JSON.stringify({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] }),
      );
    });

    const godAnd: TokenSnapshot[] = [
      { tokenRef: 'GEN 1:1:17', surfaceText: 'God' },
      { tokenRef: 'GEN 1:2:0', surfaceText: 'And' },
    ];

    const suggested = (tokens: TokenSnapshot[]): Partial<TextAnalysis> => ({
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'God And' }],
      phraseAnalysisLinks: [
        { id: 'pl-1', analysisId: 'pa-1', ...FIXTURE_STAMPS, status: 'suggested', tokens },
      ],
    });

    it.each([
      ['createPhrase', (c: SessionCommands, id: string) => c.createPhrase(id, godAnd)],
      ['updatePhrase', (c: SessionCommands, id: string) => c.updatePhrase(id, 'pl-1', godAnd)],
      ['mergePhrases', (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-1', godAnd)],
      ['approvePhrase', (c: SessionCommands, id: string) => c.approvePhrase(id, 'pl-1')],
    ])('refuses %s over tokens in two segments, logging the error', async (intent, command) => {
      await storeDraftHolding(suggested(godAnd));
      const commands = await activateSessionCommands();
      const { sessionId } = JSON.parse(await commands.openSession('src-project'));

      await expect(command(commands, sessionId)).rejects.toThrow(
        "a phrase's tokens must lie within one segment of the text",
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        `Interlinearizer: failed to ${intent} in session ${sessionId}`,
        expect.any(Error),
      );
    });

    it('refuses a phrase over a token the text lacks', async () => {
      const { openSession, createPhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(
        createPhrase(sessionId, [inThe[0], { tokenRef: 'GEN 1:1:1', surfaceText: 'the' }]),
      ).rejects.toThrow("a phrase's tokens must lie within one segment of the text");
    });

    it('approves a suggested phrase within one segment, replying with the changes', async () => {
      await storeDraftHolding(suggested(inThe));
      const { openSession, approvePhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(approvePhrase(sessionId, 'pl-1').then(JSON.parse)).resolves.toMatchObject({
        intent: 'approvePhrase',
        phraseAnalysisLinks: { puts: [{ id: 'pl-1', status: 'approved' }], deletes: [] },
      });
    });

    it('leaves an approved phrase approved without reading the text', async () => {
      await storeDraftHolding({
        ...suggested(godAnd),
        phraseAnalysisLinks: [
          { id: 'pl-1', analysisId: 'pa-1', ...FIXTURE_STAMPS, status: 'approved', tokens: godAnd },
        ],
      });
      const { openSession, approvePhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(approvePhrase(sessionId, 'pl-1').then(JSON.parse)).resolves.toStrictEqual({
        intent: 'approvePhrase',
      });
      expect(bookService.getBookSegments).not.toHaveBeenCalled();
    });

    it('removes a phrase given no tokens without reading the text', async () => {
      await storeDraftHolding(suggested(godAnd));
      const { openSession, updatePhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      await expect(updatePhrase(sessionId, 'pl-1', []).then(JSON.parse)).resolves.toMatchObject({
        intent: 'updatePhrase',
        phraseAnalysisLinks: { puts: [], deletes: ['pl-1'] },
      });
      expect(bookService.getBookSegments).not.toHaveBeenCalled();
    });

    it("writes a phrase's gloss in the session's language, replying with the changes", async () => {
      await storeDraftHolding({
        phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
        phraseAnalysisLinks: [
          { id: 'pl-1', analysisId: 'pa-1', ...FIXTURE_STAMPS, status: 'approved', tokens: inThe },
        ],
      });
      const { openSession, setAnalysisLanguage, writePhraseGloss } =
        await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));
      await setAnalysisLanguage(sessionId, 'fr');

      const changes = JSON.parse(await writePhraseGloss(sessionId, 'pl-1', 'au début'));

      expect(changes).toMatchObject({
        intent: 'writePhraseGloss',
        phraseAnalyses: { puts: [{ id: 'pa-1', gloss: { fr: 'au début' } }], deletes: [] },
        phraseAnalysisLinks: { puts: [{ id: 'pl-1' }], deletes: [] },
      });
    });

    it('merges a token into a phrase when PAPI names no absorbed phrase, replying with the changes', async () => {
      await storeDraftHolding({
        phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
        phraseAnalysisLinks: [
          { id: 'pl-1', analysisId: 'pa-1', ...FIXTURE_STAMPS, status: 'approved', tokens: inThe },
        ],
      });
      const { openSession, mergePhrases } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));
      const inTheBeginning = [...inThe, beginningGod[0]];

      const changes = JSON.parse(
        // eslint-disable-next-line no-null/no-null -- PAPI delivers an omitted argument as null
        await mergePhrases(sessionId, 'pl-1', inTheBeginning, null),
      );

      expect(changes).toMatchObject({
        intent: 'mergePhrases',
        phraseAnalyses: { puts: [{ id: 'pa-1', surfaceText: 'In the beginning' }], deletes: [] },
        phraseAnalysisLinks: { puts: [{ id: 'pl-1', tokens: inTheBeginning }], deletes: [] },
      });
    });

    it("splits a phrase in its book's document order, replying with the changes", async () => {
      const before: TokenSnapshot[] = [
        { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
        { tokenRef: 'GEN 1:1:3', surfaceText: 'the' },
      ];
      const after: TokenSnapshot[] = [
        { tokenRef: 'GEN 1:1:7', surfaceText: 'beginning' },
        { tokenRef: 'GEN 1:2:0', surfaceText: 'And' },
      ];
      await storeDraftHolding({
        phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning And' }],
        phraseAnalysisLinks: [
          {
            id: 'pl-1',
            analysisId: 'pa-1',
            ...FIXTURE_STAMPS,
            status: 'approved',
            tokens: [...after, ...before],
          },
        ],
      });
      const { openSession, splitPhrase } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      const changes = JSON.parse(await splitPhrase(sessionId, 'pl-1', 'GEN 1:1:3'));

      expect(changes).toMatchObject({
        intent: 'splitPhrase',
        phraseAnalysisLinks: {
          puts: [
            { id: 'pl-1', tokens: before },
            { status: 'approved', tokens: after },
          ],
          deletes: [],
        },
      });
    });

    type SessionCommands = Awaited<ReturnType<typeof activateSessionCommands>>;

    it.each([
      [
        'updatePhrase',
        'updatePhrase',
        (c: SessionCommands, id: string) => c.updatePhrase(id, 'pl-1', inThe),
      ],
      [
        'deletePhrase',
        'deletePhrase',
        (c: SessionCommands, id: string) => c.deletePhrase(id, 'pl-1'),
      ],
      [
        'mergePhrases absorbing a phrase',
        'mergePhrases',
        (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-1', inThe, 'pl-2'),
      ],
      [
        'mergePhrases absorbing a token in no phrase',
        'mergePhrases',
        (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-1', inThe),
      ],
      [
        'approvePhrase',
        'approvePhrase',
        (c: SessionCommands, id: string) => c.approvePhrase(id, 'pl-1'),
      ],
      [
        'writeSegmentFreeTranslation clearing nothing',
        'writeSegmentFreeTranslation',
        (c: SessionCommands, id: string) =>
          c.writeSegmentFreeTranslation(id, 'GEN 1:1', 'In the beginning', '', 'sa-stale'),
      ],
      [
        'writeSegmentFreeTranslation clearing nothing, adopting a translation named null',
        'writeSegmentFreeTranslation',
        (c: SessionCommands, id: string) =>
          // eslint-disable-next-line no-null/no-null -- PAPI delivers an omitted argument as null
          c.writeSegmentFreeTranslation(id, 'GEN 1:1', 'In the beginning', '', null),
      ],
      [
        "mergeSegments on the book's first segment",
        'mergeSegments',
        (c: SessionCommands, id: string) => c.mergeSegments(id, 'GEN 1:1:0'),
      ],
      [
        'splitSegment before a segment start',
        'splitSegment',
        (c: SessionCommands, id: string) => c.splitSegment(id, 'GEN 1:2:0'),
      ],
      [
        'moveBoundary onto the token it is at',
        'moveBoundary',
        (c: SessionCommands, id: string) => c.moveBoundary(id, 'GEN 1:2:0', 'GEN 1:2:0'),
      ],
    ])(
      'runs %s as an edit of the session, replying with the changes',
      async (_name, intent, command) => {
        const commands = await activateSessionCommands();
        const { sessionId } = JSON.parse(await commands.openSession('src-project'));

        await expect(command(commands, sessionId).then(JSON.parse)).resolves.toStrictEqual({
          intent,
        });
      },
    );

    it.each([
      ['createPhrase', (c: SessionCommands, id: string) => c.createPhrase(id, [])],
      ['mergePhrases', (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-1', [])],
    ])('refuses %s over no tokens, logging the error', async (intent, command) => {
      const commands = await activateSessionCommands();
      const { sessionId } = JSON.parse(await commands.openSession('src-project'));

      await expect(command(commands, sessionId)).rejects.toThrow(
        'a phrase needs at least one token',
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        `Interlinearizer: failed to ${intent} in session ${sessionId}`,
        expect.any(Error),
      );
    });

    it.each([
      [
        'createPhrase',
        (c: SessionCommands, id: string) => c.createPhrase(id, [inThe[1], beginningGod[0]]),
      ],
      [
        'updatePhrase',
        (c: SessionCommands, id: string) => c.updatePhrase(id, 'pl-2', [inThe[1], ...beginningGod]),
      ],
      [
        'mergePhrases',
        (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-2', [inThe[1], ...beginningGod]),
      ],
    ])('refuses %s over a token in another approved phrase', async (_intent, command) => {
      await storeDraftHolding({
        phraseAnalyses: [
          { id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' },
          { id: 'pa-2', ...FIXTURE_STAMPS, surfaceText: 'beginning God' },
        ],
        phraseAnalysisLinks: [
          { id: 'pl-1', analysisId: 'pa-1', ...FIXTURE_STAMPS, status: 'approved', tokens: inThe },
          {
            id: 'pl-2',
            analysisId: 'pa-2',
            ...FIXTURE_STAMPS,
            status: 'approved',
            tokens: beginningGod,
          },
        ],
      });
      const commands = await activateSessionCommands();
      const { sessionId } = JSON.parse(await commands.openSession('src-project'));

      await expect(command(commands, sessionId)).rejects.toThrow(ApprovalRuleError);
    });

    it("writes a segment's free translation in the session's language, replying with the changes", async () => {
      const { openSession, setAnalysisLanguage, writeSegmentFreeTranslation } =
        await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));
      await setAnalysisLanguage(sessionId, 'fr');

      const changes = JSON.parse(
        await writeSegmentFreeTranslation(
          sessionId,
          'GEN 1:1',
          'In the beginning',
          'Au commencement',
        ),
      );

      expect(changes).toMatchObject({
        intent: 'writeSegmentFreeTranslation',
        segmentAnalyses: {
          puts: [{ surfaceText: 'In the beginning', freeTranslation: { fr: 'Au commencement' } }],
          deletes: [],
        },
        segmentAnalysisLinks: { puts: [{ status: 'approved', segmentId: 'GEN 1:1' }], deletes: [] },
      });
    });

    it.each([
      [
        'mergeSegments',
        (c: SessionCommands, id: string) => c.mergeSegments(id, 'GEN 1:2:0'),
        { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      ],
      [
        'splitSegment',
        (c: SessionCommands, id: string) => c.splitSegment(id, 'GEN 1:1:3'),
        { removedVerseStarts: [], addedStarts: [{ tokenRef: 'GEN 1:1:3', surfaceText: 'the' }] },
      ],
      [
        'moveBoundary',
        (c: SessionCommands, id: string) => c.moveBoundary(id, 'GEN 1:2:0', 'GEN 1:2:4'),
        {
          removedVerseStarts: ['GEN 1:2:0'],
          addedStarts: [{ tokenRef: 'GEN 1:2:4', surfaceText: 'the' }],
        },
      ],
    ])(
      "runs %s over the token's book of the session's project, replying with the boundaries",
      async (intent, command, segmentation) => {
        const commands = await activateSessionCommands();
        const { sessionId } = JSON.parse(await commands.openSession('src-project'));

        const changes = JSON.parse(await command(commands, sessionId));

        expect(changes).toMatchObject({ intent, scope: { segmentation } });
        expect(bookService.getVerseBook).toHaveBeenCalledWith('src-project', 'GEN');
      },
    );

    it('splits a segment and the phrase its new boundary cuts as one edit', async () => {
      const phrase: PhraseAnalysisLink = {
        id: 'pl-1',
        analysisId: 'pa-1',
        ...FIXTURE_STAMPS,
        status: 'approved',
        tokens: [
          { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
          { tokenRef: 'GEN 1:1:3', surfaceText: 'the' },
          { tokenRef: 'GEN 1:1:7', surfaceText: 'beginning' },
        ],
      };
      await storeDraftHolding({
        phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning' }],
        phraseAnalysisLinks: [phrase],
      });
      const { openSession, splitSegment } = await activateSessionCommands();
      const { sessionId } = JSON.parse(await openSession('src-project'));

      const changes = JSON.parse(await splitSegment(sessionId, 'GEN 1:1:3'));

      expect(changes).toMatchObject({
        intent: 'splitSegment',
        phraseAnalysisLinks: { puts: [{ id: 'pl-1', tokens: phrase.tokens.slice(1) }] },
        scope: { segmentation: { addedStarts: [{ tokenRef: 'GEN 1:1:3' }] } },
      });
    });

    const exodus: TokenSnapshot[] = [
      { tokenRef: 'EXO 1:1:0', surfaceText: 'Now' },
      { tokenRef: 'EXO 1:1:4', surfaceText: 'these' },
    ];

    it.each([
      ['createPhrase', (c: SessionCommands, id: string) => c.createPhrase(id, exodus)],
      ['updatePhrase', (c: SessionCommands, id: string) => c.updatePhrase(id, 'pl-1', exodus)],
      ['mergePhrases', (c: SessionCommands, id: string) => c.mergePhrases(id, 'pl-1', exodus)],
      ['approvePhrase', (c: SessionCommands, id: string) => c.approvePhrase(id, 'pl-1')],
      ['splitPhrase', (c: SessionCommands, id: string) => c.splitPhrase(id, 'pl-1', 'EXO 1:1:0')],
      ['mergeSegments', (c: SessionCommands, id: string) => c.mergeSegments(id, 'EXO 1:2:0')],
      ['splitSegment', (c: SessionCommands, id: string) => c.splitSegment(id, 'EXO 1:1:3')],
      [
        'moveBoundary',
        (c: SessionCommands, id: string) => c.moveBoundary(id, 'EXO 1:2:0', 'EXO 1:2:4'),
      ],
    ])(
      'refuses %s in a book the project has no text for, logging the error',
      async (intent, command) => {
        await storeDraftHolding(suggested(exodus));
        jest.mocked(bookService.getVerseBook).mockResolvedValue(undefined);
        jest.mocked(bookService.getBookSegments).mockResolvedValue(undefined);
        const commands = await activateSessionCommands();
        const { sessionId } = JSON.parse(await commands.openSession('src-project'));

        await expect(command(commands, sessionId)).rejects.toThrow(
          'project src-project has no text for book EXO',
        );
        expect(__mockLogger.error).toHaveBeenCalledWith(
          `Interlinearizer: failed to ${intent} in session ${sessionId}`,
          expect.any(Error),
        );
      },
    );

    it('closes every session on deactivation', async () => {
      const { openSession } = await activateSessionCommands();
      await openSession('src-project');

      await deactivate();

      expect(projectStorage.releaseDraftRepository).toHaveBeenCalledWith('src-project');
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
