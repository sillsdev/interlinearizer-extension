import type { EntryRef, SenseRef } from 'interlinearizer';
import type { LexemeKeyData } from 'parsers/pt9/lexemeKey';

/**
 * Resolves PT9 lexical identities to Lexicon-extension references.
 *
 * Returning `undefined` is a normal outcome rather than an error: an unresolved identity is stored
 * with no reference at all, never a PT9-shaped one, leaving inlined gloss text as its only record.
 *
 * Lookups are synchronous, so an implementation backed by an asynchronous lexicon service must
 * materialize its answers before conversion begins.
 */
export interface Pt9LexiconResolver {
  /** Resolves a lexeme key to a Lexicon-extension entry, or `undefined` when unknown. */
  resolveEntry(key: LexemeKeyData): EntryRef | undefined;

  /**
   * Resolves one sense of a lexeme to a Lexicon-extension sense, or `undefined` when unknown. PT9
   * sense ids are only unique per entry, so the owning key travels with the id.
   */
  resolveSense(key: LexemeKeyData, senseId: string): SenseRef | undefined;
}

/**
 * A resolver that resolves nothing, leaving every imported record with inlined gloss text and no
 * lexicon references.
 */
export const unresolvedPt9LexiconResolver: Pt9LexiconResolver = {
  resolveEntry: () => undefined,
  resolveSense: () => undefined,
};
