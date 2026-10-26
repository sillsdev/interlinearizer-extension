import type { AnalysisRepository } from '../../types/analysis-repository';
import type { ChangeBuffer } from './changeBuffer';

/** Thrown by an edit that would give a token or segment a second approved link. */
export class ApprovalRuleError extends Error {
  /** The token refs and segment ids the edit would leave holding several approved links. */
  readonly places: readonly string[];

  constructor(places: readonly string[]) {
    super(`Interlinearizer: an edit would approve several analyses at ${places.join(', ')}`);
    this.name = 'ApprovalRuleError';
    this.places = places;
  }
}

/** How many approved links each place holds, placing each link by `placeOf`. */
function approvedCounts<Link extends { status: string }>(
  links: readonly Link[],
  placeOf: (link: Link) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  links.forEach((link) => {
    if (link.status !== 'approved') return;
    counts.set(placeOf(link), (counts.get(placeOf(link)) ?? 0) + 1);
  });
  return counts;
}

/** The places where `after` holds more than one approved link, and more than `before` held. */
function breaches<Link extends { status: string }>(
  before: readonly Link[],
  after: readonly Link[],
  placeOf: (link: Link) => string,
): string[] {
  const held = approvedCounts(before, placeOf);
  return [...approvedCounts(after, placeOf)].flatMap(([place, count]) =>
    count > 1 && count > (held.get(place) ?? 0) ? [place] : [],
  );
}

/**
 * Refuses the staged changes where they would give a token or segment more than one approved link,
 * and more than it has now.
 *
 * @throws {ApprovalRuleError} If the changes breach the rule anywhere.
 */
export async function assertApprovalRule(
  buffer: ChangeBuffer,
  repository: AnalysisRepository,
): Promise<void> {
  const tokenRefs = [
    ...new Set(buffer.touched('tokenAnalysisLinks').map(({ token }) => token.tokenRef)),
  ];
  const segmentIds = [...new Set(buffer.touched('segmentAnalysisLinks').map((l) => l.segmentId))];
  const found = [
    ...breaches(
      (await repository.findLinksByToken(tokenRefs)).tokenAnalysisLinks,
      (await buffer.findLinksByToken(tokenRefs)).tokenAnalysisLinks,
      ({ token }) => token.tokenRef,
    ),
    ...breaches(
      await repository.findLinksBySegment(segmentIds),
      await buffer.findLinksBySegment(segmentIds),
      ({ segmentId }) => segmentId,
    ),
  ];
  if (found.length > 0) throw new ApprovalRuleError(found);
}
