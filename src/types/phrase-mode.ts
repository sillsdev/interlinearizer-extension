import type { PhraseAnalysisLink } from 'interlinearizer';

/** The phrase-interaction mode the interlinear view is currently in. */
export type PhraseMode =
  /** Normal reading and glossing; no phrase operation is in progress. */
  | { kind: 'view' }
  /** The user is adding tokens to or removing them from an existing phrase. */
  | {
      kind: 'edit';
      phraseId: string;
      /** The phrase's token list as it stood when edit mode was entered, so a cancel can restore it. */
      originalTokens: PhraseAnalysisLink['tokens'];
      /**
       * Set once cancel has been pressed: observers should restore `originalTokens` and return to
       * `view`.
       */
      revert?: true;
    }
  /** Awaiting the user's confirmation before deleting the phrase. */
  | { kind: 'confirm-unlink'; phraseId: string };
