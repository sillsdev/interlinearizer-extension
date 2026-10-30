import type { Book, DraftProject } from 'interlinearizer';
import type { DraftContent } from '../types/draft-content';
import type { ChangeSet, RecordChanges } from '../types/analysis-repository';
import { scopeRecordOf } from './change-set';
import { reanchorDraftToBook } from './reanchor-draft';
import type { BookPass } from './undo-history';

/** Names the changes a re-anchor pass makes. */
export const REANCHOR_INTENT = 'reanchor';

/**
 * The records of `after` that differ from `before`'s record of the same id. A pass only rewrites
 * records, never adding or removing one, so these are all it changed.
 */
function rewritten<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
): RecordChanges<T> | undefined {
  const prior = new Map(before.map((record) => [record.id, record]));
  const puts = after.filter((record) => prior.get(record.id) !== record);
  return puts.length > 0 ? { puts, deletes: [] } : undefined;
}

/**
 * The changes that bring `draft` to the content that a re-anchor pass made of it.
 *
 * @returns The changes, or `undefined` when the pass made nothing new.
 */
export function changesOfReanchor(
  draft: DraftProject,
  { analysis, segmentation }: DraftContent,
): ChangeSet | undefined {
  const tokenAnalysisLinks = rewritten(
    draft.analysis.tokenAnalysisLinks,
    analysis.tokenAnalysisLinks,
  );
  const phraseAnalysisLinks = rewritten(
    draft.analysis.phraseAnalysisLinks,
    analysis.phraseAnalysisLinks,
  );
  const segmentAnalysisLinks = rewritten(
    draft.analysis.segmentAnalysisLinks,
    analysis.segmentAnalysisLinks,
  );
  const movesSplits = segmentation !== draft.segmentation;
  if (!movesSplits && !tokenAnalysisLinks && !phraseAnalysisLinks && !segmentAnalysisLinks) {
    return undefined;
  }
  return {
    intent: REANCHOR_INTENT,
    ...(movesSplits && { scope: { ...scopeRecordOf(draft), segmentation } }),
    ...(tokenAnalysisLinks && { tokenAnalysisLinks }),
    ...(phraseAnalysisLinks && { phraseAnalysisLinks }),
    ...(segmentAnalysisLinks && { segmentAnalysisLinks }),
  };
}

function changesOfPass(draft: DraftProject, pass: BookPass<DraftContent>): ChangeSet | undefined {
  return changesOfReanchor(
    draft,
    pass({ analysis: draft.analysis, segmentation: draft.segmentation }),
  );
}

/**
 * The changes that re-anchor `draft` to `book`'s current text, matching the WebView's pass over
 * `book`. A book the text lacks is passed as a book with no segments. The draft may hold only the
 * links in `book`, with the segment analyses they reference, and the changes are the same.
 *
 * @returns The changes, or `undefined` when the draft already reads as re-anchored.
 */
export function reanchorChangesForBook(draft: DraftProject, book: Book): ChangeSet | undefined {
  return changesOfPass(draft, reanchorDraftToBook(book));
}
