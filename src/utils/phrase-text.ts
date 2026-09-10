import type { Token, TokenSnapshot } from 'interlinearizer';

/**
 * Separator standing in for the stretch of tokens a discontiguous phrase skips, so "ne … pas" reads
 * as `ne _ pas`. Spaced unconditionally, unlike the gaps inside a contiguous run: in a script
 * written without spaces the filler is the only cue that anything is missing, and running it into
 * its neighbors hides that cue.
 */
export const PHRASE_GAP_SEPARATOR = ' _ ';

/** The book-wide lookups {@link phraseSurfaceForm} reads a phrase's text and spacing out of. */
export type PhraseTextIndexes = Readonly<{
  /** Word token ref → flat document index; a jump between two of them is a stretch skipped. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Word token ref → the live token; a ref absent from it names no word the book still has. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /** Word token ref → the verbatim baseline text separating it from the previous word. */
  gapTextByWordRef: ReadonlyMap<string, string>;
}>;

/**
 * Builds the surface form of a phrase for use in labels and tooltips: its tokens' surface texts
 * separated by the baseline text that separates them in the draft, so the punctuation inside a
 * phrase ("en, el") and the spacing of a script that writes without spaces both survive into the
 * label. A stretch the phrase skips becomes {@link PHRASE_GAP_SEPARATOR} instead, hiding whatever it
 * contains.
 *
 * Names only the words the book still has, in the order the phrase stores them, so the label reads
 * as the strip does. A ref stranded by a re-tokenized baseline draws no chip on screen, so naming
 * it would have the label claim a word the reader cannot see — and its unknown position would hide
 * every gap after it. A phrase with nothing left to name comes back empty.
 *
 * @param tokens - Phrase token snapshots, in the order the link stores them.
 * @param indexes - Book-wide lookups, which decide both which tokens the book still has and where
 *   they now sit.
 */
export function phraseSurfaceForm(
  tokens: readonly TokenSnapshot[],
  indexes: PhraseTextIndexes,
): string {
  const { tokenDocOrder, wordTokenByRef, gapTextByWordRef } = indexes;
  const live = tokens.flatMap((snapshot) => {
    const token = wordTokenByRef.get(snapshot.tokenRef);
    const order = tokenDocOrder.get(snapshot.tokenRef);
    return token !== undefined && order !== undefined ? [{ token, order }] : [];
  });

  return live
    .map(({ token, order }, i) => {
      if (i === 0) return token.surfaceText;
      const separator =
        order > live[i - 1].order + 1
          ? PHRASE_GAP_SEPARATOR
          : (gapTextByWordRef.get(token.ref) ?? ' ');
      return separator + token.surfaceText;
    })
    .join('');
}
