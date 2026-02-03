import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  IWebViewProvider,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';

/**
 * WebView type identifier for the interlinearizer. Used when registering the provider and when
 * opening the WebView from the platform.
 */
const mainWebViewType = 'paranextExtensionTemplate.interlinearizer';

/** WebView provider that provides the interlinearizer React WebView when Platform.Bible requests it. */
const mainWebViewProvider: IWebViewProvider = {
  /**
   * Returns the interlinearizer WebView definition (React component + styles) for the given saved
   * definition. Rejects if the requested webViewType does not match this provider's type.
   *
   * @param savedWebView - Platform-provided definition (webViewType, etc.).
   * @returns WebView definition with title, content, and styles, or undefined.
   * @throws {Error} When savedWebView.webViewType is not the interlinearizer type.
   */
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== mainWebViewType) {
      throw new Error(
        `${mainWebViewType} provider received request to provide a ${savedWebView.webViewType} WebView`,
      );
    }
    return {
      ...savedWebView,
      title: 'Interlinearizer',
      content: interlinearizerReact,
      styles: interlinearizerStyles,
    };
  },
};

/**
 * Extension entry point. Registers the interlinearizer WebView provider and opens the WebView.
 * Called by the platform when the extension is loaded.
 *
 * @param context - Activation context; used to register the WebView provider so the platform can
 *   clean it up on deactivation.
 */
export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

  const mainWebViewProviderRegistration = await papi.webViewProviders.registerWebViewProvider(
    mainWebViewType,
    mainWebViewProvider,
  );

  context.registrations.add(mainWebViewProviderRegistration);

  try {
    await papi.webViews.openWebView(mainWebViewType, undefined, { existingId: '?' });
  } catch (err) {
    logger.error(`Failed to open ${mainWebViewType} WebView: ${err}`);
  }

  logger.debug('Interlinearizer extension finished activating!');
}

/**
 * Extension teardown. Called by the platform when the extension is unloaded. Registrations added
 * during activate are disposed by the platform.
 *
 * @returns True to indicate successful deactivation; the platform may use this for logging.
 */
export async function deactivate(): Promise<boolean> {
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}
