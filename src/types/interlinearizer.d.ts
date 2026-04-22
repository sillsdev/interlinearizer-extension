/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */

declare module 'papi-shared-types' {
  export interface CommandHandlers {
    /**
     * Opens the Interlinearizer WebView. If `projectId` is omitted, shows a project picker dialog.
     * Returns the WebView ID, or undefined if the user cancels.
     */
    'interlinearizer.open': (projectId?: string) => Promise<string | undefined>;
    /**
     * Opens the Interlinearizer for the project associated with the given WebView ID. Called from
     * webview context menus, which pass the tab's webView ID as the argument. Falls back to a
     * project picker dialog if the webView has no project or no ID is given.
     */
    'interlinearizer.openForWebView': (webViewId?: string) => Promise<string | undefined>;
  }
}
