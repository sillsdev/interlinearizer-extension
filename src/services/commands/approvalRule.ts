import type { PhraseAnalysisLink } from 'interlinearizer';
import type { AnalysisRepository } from '../../types/analysis-repository';
import type { ChangeBuffer } from './changeBuffer';

/**
 * Thrown by an edit that would give a token or segment a second approved link, or put a token in a
 * second approved phrase.
 */
export class ApprovalRuleError extends Error {
  /** The token refs and segment ids the edit would leave holding several approved links. */
  readonly places: readonly string[];

  constructor(places: readonly string[]) {
    super(`Interlinearizer: an edit would approve several analyses at ${places.join(', ')}`);
    this.name = 'ApprovalRuleError';
    this.places = places;
  }
}

/**
 * How many approved links each place holds, counting each link at every place that `placesOf` gives
 * it.
 */
function approvedCounts<Link extends { status: string }>(
  links: readonly Link[],
  placesOf: (link: Link) => readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  links.forEach((link) => {
    if (link.status !== 'approved') return;
    placesOf(link).forEach((place) => counts.set(place, (counts.get(place) ?? 0) + 1));
  });
  return counts;
}

/** The places where `after` holds more than one approved link, and more than `before` held. */
function breaches<Link extends { status: string }>(
  before: readonly Link[],
  after: readonly Link[],
  placesOf: (link: Link) => readonly string[],
): string[] {
  const held = approvedCounts(before, placesOf);
  return [...approvedCounts(after, placesOf)].flatMap(([place, count]) =>
    count > 1 && count > (held.get(place) ?? 0) ? [place] : [],
  );
}

const phraseTokenRefs = ({ tokens }: PhraseAnalysisLink) => tokens.map(({ tokenRef }) => tokenRef);

/**
 * Refuses the staged changes where they would give a token or segment more than one approved link,
 * or put a token in more than one approved phrase. At a place already over the limit, the changes
 * are refused only when they add to it.
 *
 * @throws {ApprovalRuleError} If the changes breach the rule anywhere.
 */
export async function assertApprovalRule(
  buffer: ChangeBuffer,
  repository: AnalysisRepository,
): Promise<void> {
  const tokenRefs = [
    ...new Set([
      ...buffer.touched('tokenAnalysisLinks').map(({ token }) => token.tokenRef),
      ...buffer.touched('phraseAnalysisLinks').flatMap(phraseTokenRefs),
    ]),
  ];
  const segmentIds = [...new Set(buffer.touched('segmentAnalysisLinks').map((l) => l.segmentId))];
  const onTokensBefore = await repository.findLinksByToken(tokenRefs);
  const onTokensAfter = await buffer.findLinksByToken(tokenRefs);
  const found = [
    ...breaches(
      onTokensBefore.tokenAnalysisLinks,
      onTokensAfter.tokenAnalysisLinks,
      ({ token }) => [token.tokenRef],
    ),
    ...breaches(
      onTokensBefore.phraseAnalysisLinks,
      onTokensAfter.phraseAnalysisLinks,
      phraseTokenRefs,
    ),
    ...breaches(
      await repository.findLinksBySegment(segmentIds),
      await buffer.findLinksBySegment(segmentIds),
      ({ segmentId }) => [segmentId],
    ),
  ];
  if (found.length > 0) throw new ApprovalRuleError(found);
}
