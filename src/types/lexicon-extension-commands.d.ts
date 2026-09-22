/**
 * @file The Lexicon extension's commands this extension sends. Restated here for the reason
 *   `lexicon-extension-settings.d.ts` gives about its settings: that extension's own declarations
 *   reach a build only through `paranext-core/dev-appdata/cache/extension-types`, which installing
 *   it populates, and neither CI nor a fresh clone can assume that.
 *
 *   A declaration that drifts from that extension's own is a build error wherever both are installed,
 *   which is the point: the two are changed together.
 *
 *   Not named `lexicon-extension.d.ts`: TypeScript would read that as the declarations for the
 *   `lexicon-extension.ts` beside it and never merge the augmentation.
 */

declare module 'papi-shared-types' {
  /** Commands the Interlinearizer sends but does not register. */
  export interface CommandHandlers {
    /**
     * Opens the Lexicon extension's lexicon selector for a Paratext project, which is where a
     * FieldWorks Lite lexicon is chosen, created, or signed in to.
     *
     * That extension commits the choice to its own `lexicon.lexiconCode` project setting, which is
     * where this one reads the link back from, so nothing comes back here but whether the selector
     * opened.
     *
     * The returned shape is the Lexicon extension's `SuccessHolder`, restated because that type is
     * not importable here.
     */
    'lexicon.openSelector': (projectId: string) => Promise<{ success: boolean; error?: string }>;
  }
}
