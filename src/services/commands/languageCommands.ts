import type { TextAnalysis } from 'interlinearizer';
import { retagGlosses, type GlossRetagCounts } from '../../utils/retag-glosses';
import type { ChangeBuffer } from './changeBuffer';
import { mergeIntoIdenticalPayload } from './tokenCommands';

/** What changing a draft's analysis languages needs. */
export type ChangeAnalysisLanguagesRequest = {
  /** The draft's new analysis languages, primary first; never empty. */
  analysisLanguages: readonly string[];
  /**
   * The tag whose glosses move to the new primary language, or `undefined` to move none. Never the
   * new primary language itself.
   */
  retagFrom?: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/**
 * Stages in `buffer` the change giving the draft new analysis languages. With `retagFrom`, it also
 * moves the glosses under `retagFrom` in `stored`, the draft's analysis, to the new primary
 * language, mutating `stored`. A gloss whose word or morpheme already has a different one in the
 * new primary language stays where it is. A token analysis the move makes identical to another
 * payload is folded into that payload.
 *
 * @returns What moved, or `undefined` when no glosses were asked to move.
 */
export async function changeAnalysisLanguages(
  buffer: ChangeBuffer,
  stored: TextAnalysis,
  { analysisLanguages, retagFrom, now }: ChangeAnalysisLanguagesRequest,
): Promise<GlossRetagCounts | undefined> {
  const scope = await buffer.getScope();
  buffer.putScope({ ...scope, analysisLanguages: [...analysisLanguages] });
  if (retagFrom === undefined) return undefined;

  const { counts, tokenAnalyses, phraseAnalyses } = retagGlosses(
    stored,
    retagFrom,
    analysisLanguages[0],
    now,
  );
  tokenAnalyses.forEach((analysis) => buffer.put('tokenAnalyses', analysis));
  phraseAnalyses.forEach((analysis) => buffer.put('phraseAnalyses', analysis));
  // Folded only once every gloss has moved, so that each analysis is compared as the move leaves
  // it rather than against one not yet moved.
  const fold = async (analysisId: string) => {
    const [analysis] = await buffer.getTokenAnalyses([analysisId]);
    if (analysis) await mergeIntoIdenticalPayload(buffer, analysis, now);
  };
  await tokenAnalyses.reduce<Promise<unknown>>(
    (previous, { id }) => previous.then(() => fold(id)),
    Promise.resolve(),
  );
  return counts;
}
