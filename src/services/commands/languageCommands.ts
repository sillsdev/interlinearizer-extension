import type { PhraseAnalysis, SegmentAnalysis, TextAnalysis, TokenAnalysis } from 'interlinearizer';
import type { AnalysisLanguagesChangeOutcome } from '../../types/analysis-languages-change';
import {
  analysesAreIdentical,
  normalizeSurfaceForm,
  phraseAnalysesAreIdentical,
} from '../../utils/analysis-identity';
import { deleteLanguageText } from '../../utils/delete-language-text';
import { isEmptyMultiString } from '../../utils/multi-string';
import { retagGlosses } from '../../utils/retag-glosses';
import { isEmptyTokenAnalysis } from '../../utils/token-analysis-content';
import type { ChangeBuffer } from './changeBuffer';
import { mergeIntoIdenticalPhrase } from './phraseCommands';
import { mergeIntoIdenticalPayload } from './tokenCommands';

/** What changing a draft's analysis languages needs. */
export type ChangeAnalysisLanguagesRequest = {
  /** The draft's new analysis languages, primary first; never empty. */
  analysisLanguages: readonly string[];
  /**
   * Glosses and free translations to move from one tag to another, or `undefined` to move none.
   * `from` and `to` are never the same tag.
   */
  retag?: Readonly<{ from: string; to: string }>;
  /** The tag whose glosses and free translations are deleted, or `undefined` to delete none. */
  deleteTextOf?: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/** The analyses in `changed` that are identical to another analysis in `all`. */
function withIdenticalTwin<T extends { id: string; surfaceText: string }>(
  changed: readonly T[],
  all: readonly T[],
  isIdentical: (a: T, b: T) => boolean,
): T[] {
  const byForm = new Map<string, T[]>();
  all.forEach((analysis) => {
    const form = normalizeSurfaceForm(analysis.surfaceText);
    const bucket = byForm.get(form);
    if (bucket) bucket.push(analysis);
    else byForm.set(form, [analysis]);
  });
  const changedIds = new Set(changed.map(({ id }) => id));
  const twinned = new Set<string>();
  byForm.forEach((bucket) =>
    bucket.forEach((analysis) => {
      if (
        changedIds.has(analysis.id) &&
        bucket.some((other) => other.id !== analysis.id && isIdentical(other, analysis))
      )
        twinned.add(analysis.id);
    }),
  );
  return changed.filter(({ id }) => twinned.has(id));
}

/** Whether a segment analysis holds neither a free nor a literal translation. */
function isEmptySegmentAnalysis({ freeTranslation, literalTranslation }: SegmentAnalysis): boolean {
  return isEmptyMultiString(freeTranslation) && isEmptyMultiString(literalTranslation);
}

/**
 * Stages removing each token and segment analysis that a change left holding nothing, with every
 * link to it.
 *
 * @returns The token analyses that still hold something.
 */
async function removeEmptied(
  buffer: ChangeBuffer,
  tokenAnalyses: readonly TokenAnalysis[],
  segmentAnalyses: readonly SegmentAnalysis[],
): Promise<TokenAnalysis[]> {
  const emptiedTokens = tokenAnalyses.filter(isEmptyTokenAnalysis);
  const emptiedSegments = segmentAnalyses.filter(isEmptySegmentAnalysis);
  if (emptiedTokens.length + emptiedSegments.length > 0) {
    const links = await buffer.findLinksToAnalyses(
      [...emptiedTokens, ...emptiedSegments].map(({ id }) => id),
    );
    links.tokenAnalysisLinks.forEach((link) => buffer.delete('tokenAnalysisLinks', link));
    links.segmentAnalysisLinks.forEach((link) => buffer.delete('segmentAnalysisLinks', link));
    emptiedTokens.forEach((analysis) => buffer.delete('tokenAnalyses', analysis));
    emptiedSegments.forEach((analysis) => buffer.delete('segmentAnalyses', analysis));
  }
  return tokenAnalyses.filter((analysis) => !emptiedTokens.includes(analysis));
}

/**
 * Stages the analyses that a move or deletion changed in `all`, the draft's analysis as the change
 * leaves it. A token or segment analysis left holding nothing goes, with every link to it. Any
 * other token or phrase analysis that the change made identical to another payload is folded into
 * that payload.
 */
async function stageTextChange(
  buffer: ChangeBuffer,
  all: TextAnalysis,
  {
    tokenAnalyses,
    phraseAnalyses,
    segmentAnalyses,
  }: {
    tokenAnalyses: readonly TokenAnalysis[];
    phraseAnalyses: readonly PhraseAnalysis[];
    segmentAnalyses: readonly SegmentAnalysis[];
  },
  now: string,
): Promise<void> {
  tokenAnalyses.forEach((analysis) => buffer.put('tokenAnalyses', analysis));
  phraseAnalyses.forEach((analysis) => buffer.put('phraseAnalyses', analysis));
  segmentAnalyses.forEach((analysis) => buffer.put('segmentAnalyses', analysis));
  const kept = await removeEmptied(buffer, tokenAnalyses, segmentAnalyses);
  // Folded only once every analysis is staged, so that each is compared as the change leaves it
  // rather than against one not yet changed.
  const foldToken = async (analysisId: string) => {
    const [analysis] = await buffer.getTokenAnalyses([analysisId]);
    if (analysis) await mergeIntoIdenticalPayload(buffer, analysis, now);
  };
  const foldPhrase = async (analysisId: string) => {
    const [analysis] = await buffer.getPhraseAnalyses([analysisId]);
    if (analysis) await mergeIntoIdenticalPhrase(buffer, analysis);
  };
  // Each fold reads the whole staged change, so only analyses that can fold are visited.
  await withIdenticalTwin(kept, all.tokenAnalyses, analysesAreIdentical).reduce<Promise<unknown>>(
    (previous, { id }) => previous.then(() => foldToken(id)),
    Promise.resolve(),
  );
  await withIdenticalTwin(phraseAnalyses, all.phraseAnalyses, phraseAnalysesAreIdentical).reduce<
    Promise<unknown>
  >((previous, { id }) => previous.then(() => foldPhrase(id)), Promise.resolve());
}

/**
 * Stages in `buffer` the change giving the draft new analysis languages, mutating `stored`, the
 * draft's analysis, for any text it moves or deletes:
 *
 * - With `deleteTextOf`, the glosses and free translations under that tag are deleted.
 * - With `retag`, those under `retag.from` move to `retag.to`. One that already has different text
 *   under `retag.to` stays where it is.
 *
 * A token or phrase analysis the change makes identical to another payload is folded into it.
 */
export async function changeAnalysisLanguages(
  buffer: ChangeBuffer,
  stored: TextAnalysis,
  { analysisLanguages, retag, deleteTextOf, now }: ChangeAnalysisLanguagesRequest,
): Promise<AnalysisLanguagesChangeOutcome> {
  const scope = await buffer.getScope();
  buffer.putScope({ ...scope, analysisLanguages: [...analysisLanguages] });
  const outcome: AnalysisLanguagesChangeOutcome = {};

  if (deleteTextOf !== undefined) {
    const { counts, ...changed } = deleteLanguageText(stored, deleteTextOf, now);
    await stageTextChange(buffer, stored, changed, now);
    outcome.deletedText = counts;
  }
  if (retag !== undefined) {
    const { counts, ...changed } = retagGlosses(stored, retag.from, retag.to, now);
    await stageTextChange(buffer, stored, changed, now);
    outcome.glossRetag = counts;
  }
  return outcome;
}
