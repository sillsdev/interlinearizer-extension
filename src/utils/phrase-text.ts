import type { TokenSnapshot } from 'interlinearizer';
import { sortByDocOrder } from './phrase-arc';

/**
 * Stands in for the tokens a discontiguous phrase skips over, so "ne … pas" reads as `ne _ pas`
 * rather than as the contiguous `ne pas`.
 */
export const PHRASE_GAP_FILLER = '_';

/**
 * Builds the surface form of a phrase for use in labels and tooltips: its tokens' surface texts in
 * document order, space-joined, with {@link PHRASE_GAP_FILLER} marking each stretch of tokens the
 * phrase skips.
 *
 * Surface texts come from the link's snapshots, so a phrase whose tokens have since drifted names
 * itself as it was linked.
 *
 * @param tokens - Phrase token snapshots, in any order.
 * @param tokenDocOrder - Token ref → flat document index; tokens missing from it are treated as
 *   adjacent to their neighbors, since a gap cannot be detected without both indexes.
 */
export function phraseSurfaceForm(
  tokens: readonly TokenSnapshot[],
  tokenDocOrder: ReadonlyMap<string, number>,
): string {
  const parts: string[] = [];
  let prevOrder: number | undefined;
  sortByDocOrder(tokens, tokenDocOrder).forEach((token) => {
    const order = tokenDocOrder.get(token.tokenRef);
    if (prevOrder !== undefined && order !== undefined && order > prevOrder + 1)
      parts.push(PHRASE_GAP_FILLER);
    parts.push(token.surfaceText);
    if (order !== undefined) prevOrder = order;
  });
  return parts.join(' ');
}
