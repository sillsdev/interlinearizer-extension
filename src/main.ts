import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  IWebViewProvider,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';

const mainWebViewType = 'paranextExtensionTemplate.interlinearizer';

/** WebView provider that provides the interlinearizer React WebView when Platform.Bible requests it. */
const mainWebViewProvider: IWebViewProvider = {
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

export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

  const mainWebViewProviderPromise = papi.webViewProviders.registerWebViewProvider(
    mainWebViewType,
    mainWebViewProvider,
  );

  papi.webViews.openWebView(mainWebViewType, undefined, { existingId: '?' });

  context.registrations.add(await mainWebViewProviderPromise);

  logger.debug('Interlinearizer extension finished activating!');
}

export async function deactivate(): Promise<boolean> {
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}
