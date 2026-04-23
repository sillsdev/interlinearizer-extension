import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  IWebViewProvider,
  OpenWebViewOptions,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';

/**
 * WebView type identifier for the Interlinearizer. Used when registering the provider and when
 * opening the WebView from the platform.
 */
const mainWebViewType = 'interlinearizer.mainWebView';

/** Options passed to `openWebView` when opening the Interlinearizer. */
export interface InterlinearizerOpenOptions extends OpenWebViewOptions {
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
   * @returns WebView definition with title, content, and styles, or undefined.
   * @throws {Error} When savedWebView.webViewType is not the Interlinearizer type.
   */
  async getWebView(
    savedWebView: SavedWebViewDefinition,
    openWebViewOptions?: InterlinearizerOpenOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _webViewNonce?: string,
  ): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== mainWebViewType) {
      throw new Error(
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
 * Tracks the WebView ID opened for each project so subsequent opens of the same project bring that
 * tab to front instead of opening a duplicate. Populated and pruned via `onDidOpenWebView` and
 * `onDidCloseWebView` subscriptions registered during activation.
 */
const openWebViewsByProject = new Map<string, string>();

/**
 * Opens the Interlinearizer WebView for the given project. If no projectId is provided, shows a
 * project picker dialog. Each project gets its own tab; reopening an already-open project brings
 * that tab to front. Returns the WebView ID, or undefined if the user cancels.
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
  const webViewId = await papi.webViews.openWebView(mainWebViewType, undefined, options);
  if (webViewId) openWebViewsByProject.set(resolvedProjectId, webViewId);
  return webViewId;
}

/**
 * Opens the Interlinearizer for the project associated with the given WebView. Called from the
 * WebView context menu, which passes the tab's WebView ID as the argument.
 */
async function openInterlinearizerForWebView(webViewId?: string): Promise<string | undefined> {
  if (!webViewId) return openInterlinearizer();
  const webViewDefinition = await papi.webViews.getOpenWebViewDefinition(webViewId);
  return openInterlinearizer(webViewDefinition?.projectId);
}

/**
 * Extension entry point. Registers the Interlinearizer WebView provider and the open command.
 * Called by the platform when the extension is loaded.
 *
 * @param context - Activation context; used to register disposables so the platform can clean them
 *   up on deactivation.
 */
export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

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
        result: {
          name: 'return value',
          summary: 'The ID of the opened WebView, or undefined if cancelled',
          schema: { type: ['string', 'null'] },
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
