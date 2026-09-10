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
  /** Word token ref → the live token, whose surface text is the one the strip is showing. */
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
 * Prefers each token's live surface text over the snapshot's, so the label reads as the strip does
 * even for a phrase whose tokens have drifted since it was linked.
 *
 * @param tokens - Phrase token snapshots, read in the stored order rather than re-sorted, so a
 *   token the indexes cannot place keeps the position the phrase recorded for it.
 * @param indexes - Book-wide lookups. A token they cannot place — a ref stranded by a re-tokenized
 *   baseline, which is the drift the snapshots exist to record — keeps its snapshot text and joins
 *   its neighbor with a single space.
 */
export function phraseSurfaceForm(
  tokens: readonly TokenSnapshot[],
  indexes: PhraseTextIndexes,
): string {
  const { tokenDocOrder, wordTokenByRef, gapTextByWordRef } = indexes;
  return tokens
    .map((snapshot, i) => {
      const text = wordTokenByRef.get(snapshot.tokenRef)?.surfaceText ?? snapshot.surfaceText;
      if (i === 0) return text;
      const prevOrder = tokenDocOrder.get(tokens[i - 1].tokenRef);
      const order = tokenDocOrder.get(snapshot.tokenRef);
      const skipsTokens = prevOrder !== undefined && order !== undefined && order > prevOrder + 1;
      const separator = skipsTokens
        ? PHRASE_GAP_SEPARATOR
        : (gapTextByWordRef.get(snapshot.tokenRef) ?? ' ');
      return separator + text;
    })
    .join('');
}
