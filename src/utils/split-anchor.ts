import type { Token } from 'interlinearizer';

/**
 * Opening-class punctuation: marks that bind to the **following** word when whitespace-isolated on
 * both sides (the only case with no adjacency signal). Everything else — closing marks and sentence
 * punctuation — binds preceding when isolated. Governs **only** whitespace-isolated punctuation;
 * adjacency (a touching word) always wins over it.
 */
const OPENING_MARKS: ReadonlySet<string> = new Set([
  '"',
  "'",
  '«',
  '(',
  '[',
  '{',
  '¿',
  '¡',
  '“', // “ left double quotation mark
  '‘', // ‘ left single quotation mark
  '‹', // ‹ single left-pointing angle quotation mark
  '（', // （ fullwidth left parenthesis
  '【', // 【 left black lenticular bracket
  '「', // 「 left corner bracket
  '『', // 『 left white corner bracket
]);

/**
 * Reports whether two adjacent tokens touch, meaning no whitespace separates them. Pure adjacency
 * and script-agnostic: only the gap between the tokens is examined, never the token text itself.
 *
 * @returns `true` when there is no whitespace between the two tokens.
 */
function touches(before: Token, after: Token, baselineText: string): boolean {
  const gap = baselineText.slice(before.charEnd, after.charStart);
  return !/\s/.test(gap);
}

/**
 * Reports whether the punctuation at index `i` is joined to the word at `boundary` by an unbroken,
 * whitespace-free chain of tokens. A cluster of adjacent marks with no internal whitespace travels
 * as a unit, so a mark counts as reaching a word when every gap along the way is whitespace-free.
 *
 * @param run - The full token run for the gap: `[wordPrev, ...punctuation, wordNext]`.
 * @param i - Index of the punctuation token to test.
 * @param step - `+1` to scan toward the following word, `-1` toward the preceding one.
 * @param boundary - Index of the word the chain must reach (`run.length - 1` forward, `0` back).
 * @param baselineText - The owning segment's baseline text; inter-token gaps are read from it.
 * @returns `true` when an unbroken whitespace-free chain connects the token to that word.
 */
function reachesWord(
  run: Token[],
  i: number,
  step: number,
  boundary: number,
  baselineText: string,
): boolean {
  for (let j = i; j !== boundary; j += step) {
    // The gap always sits between the lower- and higher-indexed of the two adjacent tokens,
    // regardless of scan direction.
    const lower = Math.min(j, j + step);
    if (!touches(run[lower], run[lower + 1], baselineText)) return false;
  }
  return true;
}

/**
 * Decides whether the punctuation at index `i` in `run` binds to the following word (rather than
 * the preceding one), per the per-token priority order below. Adjacency is evaluated over the
 * whitespace-free cluster the mark belongs to, so a cluster like `("` or `,"` binds as a unit:
 *
 * 1. Touches a word (via its cluster) — reaching the following word binds following (checked first);
 *    reaching the preceding word binds preceding.
 * 2. Whitespace-isolated on both sides — consult {@link OPENING_MARKS}: opening ⇒ following.
 * 3. Isolated and not opening — default preceding (trailing).
 *
 * @param run - The full token run for the gap: `[wordPrev, ...punctuation, wordNext]`.
 * @param i - Index of the punctuation token within `run` (strictly between the two words).
 * @param baselineText - The owning segment's baseline text; inter-token gaps are read from it.
 * @returns `true` when the punctuation binds to the following word, `false` when to the preceding.
 */
function bindsFollowing(run: Token[], i: number, baselineText: string): boolean {
  if (reachesWord(run, i, 1, run.length - 1, baselineText)) return true;
  if (reachesWord(run, i, -1, 0, baselineText)) return false;
  // Whitespace-isolated on both sides: only the opening-class set has a signal.
  return OPENING_MARKS.has(run[i].surfaceText);
}

/**
 * Computes the token ref a segment split at a word-word gap should be anchored before, applying the
 * punctuation-travel rule. Re-segmentation cuts immediately before whatever anchor it is given, so
 * which side of a split the gap's punctuation lands on is entirely a matter of this choice.
 *
 * @param prevToken - The word token immediately before the gap.
 * @param nextToken - The word token immediately after the gap, and the anchor used when no
 *   punctuation binds following.
 * @param punctuation - The punctuation tokens sitting in the gap, in document order.
 * @param baselineText - The owning segment's baseline text; inter-token gaps are read from it.
 */
export function resolveSplitAnchor(
  prevToken: Token,
  nextToken: Token,
  punctuation: readonly Token[],
  baselineText: string,
): string {
  const run = [prevToken, ...punctuation, nextToken];
  for (let i = 1; i < run.length - 1; i += 1) {
    if (bindsFollowing(run, i, baselineText)) return run[i].ref;
  }
  return nextToken.ref;
}
