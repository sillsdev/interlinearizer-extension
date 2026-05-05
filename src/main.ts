import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ExecutionToken,
  IWebViewProvider,
  OpenWebViewOptions,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
import * as projectStorage from './projectStorage';

/**
 * WebView type identifier for the Interlinearizer. Used when registering the provider and when
 * opening the WebView from the platform.
 */
const mainWebViewType = 'interlinearizer.mainWebView';

/** Options passed to `openWebView` when opening the Interlinearizer. */
export interface InterlinearizerOpenOptions extends OpenWebViewOptions {
  /** Paratext project ID to load in the Interlinearizer WebView. */
  projectId?: string;
}

/** WebView provider that provides the Interlinearizer React WebView when Platform.Bible requests it. */
const mainWebViewProvider: IWebViewProvider = {
  /**
   * Returns the Interlinearizer WebView definition (React component + styles) for the given saved
   * definition. Rejects if the requested webViewType does not match this provider's type.
   *
   * @param savedWebView - Platform-provided definition (webViewType, etc.).
   * @param openWebViewOptions - Options passed by the caller; may include a projectId to link.
   * @returns WebView definition with title, content, and styles.
   * @throws {TypeError} When savedWebView.webViewType is not the Interlinearizer type.
   */
  async getWebView(
    savedWebView: SavedWebViewDefinition,
    openWebViewOptions?: InterlinearizerOpenOptions,
  ): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== mainWebViewType) {
      throw new TypeError(
        `${mainWebViewType} provider received request to provide a ${savedWebView.webViewType} WebView`,
      );
    }
    return {
      ...savedWebView,
      projectId: openWebViewOptions?.projectId ?? savedWebView.projectId,
      title: 'Interlinearizer',
      content: interlinearizerReact,
      styles: interlinearizerStyles,
    };
  },
};

/**
 * Execution token stored during activation for use in command handlers that call `papi.storage`.
 * Set in `activate()` before any command can be invoked.
 */
let executionToken: ExecutionToken;

/**
 * Tracks the WebView ID opened for each project so subsequent opens of the same project bring that
 * tab to front instead of opening a duplicate. Populated and pruned via `onDidOpenWebView` and
 * `onDidCloseWebView` subscriptions registered during activation.
 */
const openWebViewsByProject = new Map<string, string>();

/**
 * Opens the Interlinearizer WebView for the given project. If no projectId is provided, shows a
 * project picker dialog. Each project gets its own tab; reopening an already-open project brings
 * that tab to front.
 *
 * @param projectId - Project to open; if omitted a picker dialog is shown.
 * @returns The WebView ID of the opened (or focused) tab, or `undefined` if the user cancels.
 * @throws If `papi.dialogs.selectProject` or `papi.webViews.openWebView` rejects.
 */
async function openInterlinearizer(projectId?: string): Promise<string | undefined> {
  const resolvedProjectId =
    projectId ??
    (await papi.dialogs.selectProject({
      title: '%interlinearizer_dialog_open_title%',
      prompt: '%interlinearizer_dialog_open_prompt%',
    }));

  if (!resolvedProjectId) return undefined;

  const options: InterlinearizerOpenOptions = {
    existingId: openWebViewsByProject.get(resolvedProjectId),
    projectId: resolvedProjectId,
  };
  return papi.webViews.openWebView(mainWebViewType, undefined, options);
}

/**
 * Opens the Interlinearizer for the project associated with the given WebView. Called from the
 * WebView context menu, which passes the tab's WebView ID as the argument.
 *
 * @param webViewId - ID of an open WebView whose project to use; if omitted falls back to a picker.
 * @returns The WebView ID of the opened (or focused) tab, or `undefined` if the user cancels.
 * @throws If `papi.webViews.getOpenWebViewDefinition` or `openInterlinearizer` rejects.
 */
async function openInterlinearizerForWebView(webViewId?: string): Promise<string | undefined> {
  if (!webViewId) return openInterlinearizer();
  const webViewDefinition = await papi.webViews.getOpenWebViewDefinition(webViewId);
  return openInterlinearizer(webViewDefinition?.projectId);
}

/**
 * Creates a new interlinearizer project. Prompts the user to select source and target
 * Platform.Bible projects via picker dialogs. Returns the new project's ID, or undefined if the
 * user cancels either picker or if storage fails (failure is also logged and shown as a
 * notification).
 *
 * @param analysisWritingSystem - BCP 47 tag for the language used in glosses and annotations (e.g.
 *   `'en'`).
 * @returns The UUID of the new project, or `undefined` if the user cancels or storage fails.
 */
async function createInterlinearProject(
  analysisWritingSystem: string,
): Promise<string | undefined> {
  const sourceProjectId = await papi.dialogs.selectProject({
    title: '%interlinearizer_dialog_create_source_title%',
    prompt: '%interlinearizer_dialog_create_source_prompt%',
  });
  if (!sourceProjectId) return undefined;

  const targetProjectId = await papi.dialogs.selectProject({
    title: '%interlinearizer_dialog_create_target_title%',
    prompt: '%interlinearizer_dialog_create_target_prompt%',
  });
  if (!targetProjectId) return undefined;

  try {
    const project = await projectStorage.createProject(
      executionToken,
      sourceProjectId,
      targetProjectId,
      analysisWritingSystem,
    );
    return project.id;
  } catch (e) {
    logger.error('Interlinearizer: failed to create project', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_create_project_failed%',
        severity: 'error',
      })
      .catch(() => {});
    return undefined;
  }
}

/**
 * Extension entry point. Registers the Interlinearizer WebView provider and the open command.
 * Called by the platform when the extension is loaded.
 *
 * @param context - Activation context; used to register disposables so the platform can clean them
 *   up on deactivation.
 * @returns A promise that resolves when all registrations are complete.
 */
export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

  executionToken = context.executionToken;

  const mainWebViewProviderRegistration = await papi.webViewProviders.registerWebViewProvider(
    mainWebViewType,
    mainWebViewProvider,
  );

  const openForWebViewCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openForWebView',
    openInterlinearizerForWebView,
    {
      method: {
        summary: 'Open the Interlinearizer for the project associated with a WebView',
        params: [
          {
            name: 'webViewId',
            required: false,
            summary: 'The WebView ID whose project to open; if omitted a picker dialog is shown',
            schema: { type: 'string' },
          },
        ],
        // `undefined` (returned on cancel) is not a JSON type and cannot appear in a JSON-RPC
        // response, so the schema only describes the shape when a value is present. All other
        // WebView-opening commands in paranext-core use `{ type: 'string' }` for this same pattern
        // (e.g. platform-scripture-editor openScriptureEditor, platform-get-resources).
        result: {
          name: 'return value',
          summary: 'The ID of the opened WebView, if opened; omitted when the user cancels',
          schema: { type: 'string' },
        },
      },
    },
  );

  const continuousScrollValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.continuousScroll',
    async (newValue) => typeof newValue === 'boolean',
  );

  const createProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.createProject',
    createInterlinearProject,
    {
      method: {
        summary: 'Create a new interlinearizer project',
        params: [
          {
            name: 'analysisWritingSystem',
            required: true,
            summary: 'BCP 47 tag for the gloss / annotation language (e.g. "en")',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'The UUID of the new project, or undefined if the user cancelled',
          schema: { type: 'string' },
        },
      },
    },
  );

  const webViewOpenUnsubscriber = papi.webViews.onDidOpenWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    openWebViewsByProject.set(webView.projectId, webView.id);
  });

  const webViewCloseUnsubscriber = papi.webViews.onDidCloseWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    if (openWebViewsByProject.get(webView.projectId) === webView.id)
      openWebViewsByProject.delete(webView.projectId);
  });

  context.registrations.add(
    mainWebViewProviderRegistration,
    openForWebViewCommandRegistration,
    continuousScrollValidatorRegistration,
    createProjectCommandRegistration,
    webViewOpenUnsubscriber,
    webViewCloseUnsubscriber,
  );

  logger.debug('Interlinearizer extension finished activating!');
}

/**
 * Extension teardown. Called by the platform when the extension is unloaded. Registrations added
 * during activate are disposed by the platform.
 *
 * @returns True to indicate successful deactivation; the platform may use this for logging.
 */
export async function deactivate(): Promise<boolean> {
  openWebViewsByProject.clear();
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}
