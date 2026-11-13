import type { TextAnalysis } from 'interlinearizer';
import { retagGlosses, type GlossRetagCounts } from '../../utils/retag-glosses';
import type { ChangeBuffer } from './changeBuffer';
import { mergeIntoIdenticalPhrase } from './phraseCommands';
import { mergeIntoIdenticalPayload } from './tokenCommands';

/** What changing a draft's analysis languages needs. */
export type ChangeAnalysisLanguagesRequest = {
  /** The draft's new analysis languages, primary first; never empty. */
  analysisLanguages: readonly string[];
  /**
   * The tag whose glosses and free translations move to the new primary language, or `undefined` to
   * move none. Never the new primary language itself.
   */
  retagFrom?: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/**
 * Stages in `buffer` the change giving the draft new analysis languages. With `retagFrom`, it also
 * moves the glosses and free translations under `retagFrom` in `stored`, the draft's analysis, to
 * the new primary language, mutating `stored`. One that already has different text in the new
 * primary language stays where it is. A token or phrase analysis the move makes identical to
 * another payload is folded into that payload.
 *
 * @returns What moved, or `undefined` when nothing was asked to move.
 */
export async function changeAnalysisLanguages(
  buffer: ChangeBuffer,
  stored: TextAnalysis,
  { analysisLanguages, retagFrom, now }: ChangeAnalysisLanguagesRequest,
): Promise<GlossRetagCounts | undefined> {
  const scope = await buffer.getScope();
  buffer.putScope({ ...scope, analysisLanguages: [...analysisLanguages] });
  if (retagFrom === undefined) return undefined;

  const { counts, tokenAnalyses, phraseAnalyses, segmentAnalyses } = retagGlosses(
    stored,
    retagFrom,
    analysisLanguages[0],
    now,
  );
  tokenAnalyses.forEach((analysis) => buffer.put('tokenAnalyses', analysis));
  phraseAnalyses.forEach((analysis) => buffer.put('phraseAnalyses', analysis));
  segmentAnalyses.forEach((analysis) => buffer.put('segmentAnalyses', analysis));
  // Folded only once every gloss has moved, so that each analysis is compared as the move leaves
  // it rather than against one not yet moved.
  const foldToken = async (analysisId: string) => {
    const [analysis] = await buffer.getTokenAnalyses([analysisId]);
    if (analysis) await mergeIntoIdenticalPayload(buffer, analysis, now);
  };
  const foldPhrase = async (analysisId: string) => {
    const [analysis] = await buffer.getPhraseAnalyses([analysisId]);
    if (analysis) await mergeIntoIdenticalPhrase(buffer, analysis);
  };
  await tokenAnalyses.reduce<Promise<unknown>>(
    (previous, { id }) => previous.then(() => foldToken(id)),
    Promise.resolve(),
  );
  await phraseAnalyses.reduce<Promise<unknown>>(
    (previous, { id }) => previous.then(() => foldPhrase(id)),
    Promise.resolve(),
  );
  return counts;
}
