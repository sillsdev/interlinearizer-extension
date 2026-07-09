/**
 * @file The punctuation-travel rule that decides which token a segment split is anchored before,
 *   for a gap between two adjacent words. `resegmentBook` cuts immediately before whatever anchor
 *   it is given, so placing punctuation on the correct side of a split is entirely a matter of
 *   choosing the right anchor. This helper sits **above** the delta layer — it does not modify
 *   `utils/segmentation.ts` or `resegmentBook`.
 */
import type { Token } from 'interlinearizer';

/**
 * Opening-class punctuation: marks that bind to the **following** word when they are whitespace-
 * isolated on both sides (the only case with no adjacency signal). Everything else — closing marks
 * (`»`, `)`, `]`, `}`, `”`, `’`, `›`, CJK closers) and sentence punctuation (`!`, `?`, `;`, `:`,
 * `.`, `,`) — is treated as non-opening and binds preceding when isolated. This list governs **only
 * whitespace-isolated** punctuation and is deliberately extensible; adjacency (a touching word)
 * always wins over it.
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
 * Reports whether the two adjacent tokens `before` and `after` touch — i.e. the literal baseline
 * substring between them (`baselineText.slice(before.charEnd, after.charStart)`) is empty or
 * contains no whitespace. Pure adjacency, script-agnostic: the caller never scans the token text,
 * only the gap between tokens.
 *
 * @param before - The earlier token in document order.
 * @param after - The later token in document order.
 * @param baselineText - The owning segment's baseline text.
 * @returns `true` when there is no whitespace between the two tokens.
 */
function touches(before: Token, after: Token, baselineText: string): boolean {
  const gap = baselineText.slice(before.charEnd, after.charStart);
  return !/\s/.test(gap);
}

/**
 * Reports whether the punctuation at index `i` in `run` is part of an unbroken (whitespace-free)
 * chain of tokens reaching the run's word at `boundary`, scanning in `step` direction. Because a
 * cluster of adjacent marks with no internal whitespace travels as a unit, a mark reaches the
 * following word when every gap from it forward to `wordNext` is whitespace-free, and the preceding
 * word symmetrically. The word endpoints of `run` are always `boundary` when the chain arrives.
 *
 * @param run - The full token run for the gap: `[wordPrev, ...punctuation, wordNext]`.
 * @param i - Index of the punctuation token to test.
 * @param step - `+1` to scan toward `wordNext`, `-1` to scan toward `wordPrev`.
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
 * the preceding one), per the plan's per-token priority order. Adjacency is evaluated over the
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
 * Computes the anchor token ref for a segment split at the word-word gap between `prevToken` and
 * `nextToken`. Walks the punctuation tokens between them and returns the ref of the first token (in
 * document order) that binds to the **following** segment; when no punctuation binds following, the
 * anchor is `nextToken` itself.
 *
 * @param prevToken - The word token immediately before the gap.
 * @param nextToken - The word token immediately after the gap (the default anchor).
 * @param punctuation - The punctuation tokens sitting in the gap, in document order.
 * @param baselineText - The owning segment's baseline text; whitespace between tokens is read from
 *   it via the literal gap substring between adjacent tokens.
 * @returns The ref of the token the boundary should be placed before.
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
