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
  }
}
