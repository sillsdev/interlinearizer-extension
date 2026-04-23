/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */

declare module 'papi-shared-types' {
  export interface CommandHandlers {
    /**
     * Opens the Interlinearizer for the project associated with the given WebView ID. Called from
     * WebView context menus, which pass the tab's WebView ID as the argument. Falls back to a
     * project picker dialog if the WebView has no project or no ID is given.
     */
    'interlinearizer.openForWebView': (webViewId?: string) => Promise<string | undefined>;
  }
}
