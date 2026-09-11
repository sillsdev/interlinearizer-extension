/**
 * @file The Lexicon extension's project settings this extension reads. That extension owns the
 *   project-to-lexicon link, so this one reads the link rather than keeping a second copy of it.
 *
 *   Its own declarations reach a build only through
 *   `paranext-core/dev-appdata/cache/extension-types`, populated by installing it, which neither CI
 *   nor a fresh clone can assume - so the key is restated here. Declaring it in both places is safe
 *   while both say `string`; a type that drifts is a build error wherever both extensions are
 *   installed, which is the alarm we want.
 *
 *   Not named `lexicon-extension.d.ts`: TypeScript would read it as the declarations for the
 *   `lexicon-extension.ts` beside it and never merge the augmentation, leaving the key
 *   un-assignable with nothing pointing at why.
 */

declare module 'papi-shared-types' {
  /** Project-level settings the Interlinearizer extension reads but does not contribute. */
  export interface ProjectSettingTypes {
    /**
     * Names the FieldWorks Lite lexicon this Paratext project is linked to, owned and written by
     * the Lexicon extension. Empty for a project with no lexicon, and unreadable where that
     * extension is not installed; both leave this project glossing without a lexicon.
     */
    'lexicon.lexiconCode': string;
  }
}
