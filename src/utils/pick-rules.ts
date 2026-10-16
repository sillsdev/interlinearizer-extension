import type { Analysis, AnalysisLink } from 'interlinearizer';

/**
 * Whether `link` beats `rival` where one link must be picked from several, as an approval tie
 * picks: the later `updatedAt`, then the smaller id.
 */
export function prefersLink(link: AnalysisLink, rival: AnalysisLink): boolean {
  if (link.updatedAt !== rival.updatedAt) return link.updatedAt > rival.updatedAt;
  return link.id < rival.id;
}

/** The link an approval tie picks from `links`, or `undefined` when there are none. */
export function preferredLink<L extends AnalysisLink>(links: readonly L[]): L | undefined {
  return links.reduce<L | undefined>(
    (best, link) => (!best || prefersLink(link, best) ? link : best),
    undefined,
  );
}

/** The link an approval tie picks for each key `keyOf` gives, skipping links it gives none. */
export function preferredLinkByKey<L extends AnalysisLink>(
  links: readonly L[],
  keyOf: (link: L) => string | undefined,
): Map<string, L> {
  const winners = new Map<string, L>();
  links.forEach((link) => {
    const key = keyOf(link);
    if (key === undefined) return;
    const held = winners.get(key);
    if (!held || prefersLink(link, held)) winners.set(key, link);
  });
  return winners;
}

/**
 * The payload a merge folds content-identical ones into: the earliest `createdAt`, then the
 * smallest id. `undefined` when `analyses` is empty.
 */
export function preferredPayload<A extends Analysis>(analyses: readonly A[]): A | undefined {
  return analyses.reduce<A | undefined>((best, analysis) => {
    if (!best) return analysis;
    if (analysis.createdAt !== best.createdAt)
      return analysis.createdAt < best.createdAt ? analysis : best;
    return analysis.id < best.id ? analysis : best;
  }, undefined);
}
