import type { PhraseAnalysisLink } from 'interlinearizer';

/**
 * Discriminated union describing the current phrase-interaction mode in the Interlinearizer.
 *
 * - `view` — Normal reading/glossing mode; no phrase operation is in progress.
 * - `create` — User is picking tokens to form a new phrase; `draftTokenRefs` accumulates the selected
 *   token refs. When `commit` is `true` the toolbar Done button has been pressed and any
 *   `PhraseBox` that sees this should finalize the phrase and return to `view`.
 * - `edit` — User is adding/removing tokens from an existing phrase identified by `phraseId`.
 *   `originalTokens` is the token list at the moment edit mode was entered, used to restore state
 *   on cancel. When `revert` is `true` the cancel button has been pressed and any component
 *   observing this should restore the phrase to `originalTokens` and return to `view`.
 * - `confirm-unlink` — Awaiting user confirmation before deleting the phrase identified by
 *   `phraseId`.
 */
export type PhraseMode =
  | { kind: 'view' }
  | { kind: 'create'; draftTokenRefs: string[]; commit?: true }
  | { kind: 'edit'; phraseId: string; originalTokens: PhraseAnalysisLink['tokens']; revert?: true }
  | { kind: 'confirm-unlink'; phraseId: string };

/** Sentinel `analysisId` used for the synthetic draft phrase link during create mode. */
export const DRAFT_PHRASE_ID = '__draft__';
