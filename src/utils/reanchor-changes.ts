import type { DraftProject, ReadonlyBook } from 'interlinearizer';
import type { DraftContent } from '../types/draft-content';
import type { ChangeSet, RecordChanges } from '../types/analysis-repository';
import type { BookPass } from '../types/book-pass';
import { resegmentBook } from '../parsers/papi/resegmentBook';
import { scopeRecordOf } from './change-set';
import { perfTime } from './perf-marks';
import { reanchorAnalysisToBook } from './reanchor-analysis';
import { reanchorSegmentation } from './segmentation';

/** Names the changes a re-anchor pass makes. */
export const REANCHOR_INTENT = 'reanchor';

/**
 * Each record of `after` that differs from `before`'s record of the same id, as an update. A pass
 * only rewrites records, never adding or removing one, so these are all it changed.
 */
function rewritten<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
): RecordChanges<T> | undefined {
  const prior = new Map(before.map((record) => [record.id, record]));
  const updates = after.flatMap((record) => {
    const was = prior.get(record.id);
    return was && was !== record ? [{ before: was, after: record }] : [];
  });
  return updates.length > 0 ? { creates: [], updates, deletes: [] } : undefined;
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
    ...(movesSplits && {
      scope: { before: scopeRecordOf(draft), after: { ...scopeRecordOf(draft), segmentation } },
    }),
    ...(tokenAnalysisLinks && { tokenAnalysisLinks }),
    ...(phraseAnalysisLinks && { phraseAnalysisLinks }),
    ...(segmentAnalysisLinks && { segmentAnalysisLinks }),
  };
}

/** Builds the pass that re-anchors a draft's content to `verseBook`'s current text. */
export function reanchorDraftToBook(verseBook: ReadonlyBook): BookPass<DraftContent> {
  return (content) => {
    const segmentation = reanchorSegmentation(verseBook, content.segmentation);
    const analysis = perfTime(
      'reanchor',
      () =>
        reanchorAnalysisToBook(
          content.analysis,
          resegmentBook(verseBook, segmentation),
          new Date().toISOString(),
          content.segmentation?.addedStarts,
        ),
      { book: verseBook.bookRef },
    );
    return { analysis, segmentation };
  };
}

function changesOfPass(draft: DraftProject, pass: BookPass<DraftContent>): ChangeSet | undefined {
  return changesOfReanchor(
    draft,
    pass({ analysis: draft.analysis, segmentation: draft.segmentation }),
  );
}

/**
 * The changes that re-anchor `draft` to `book`'s current text, as {@link reanchorDraftToBook}'s pass
 * over `book` makes them. A book the text lacks is passed as a book with no segments. The draft may
 * hold only the links in `book`, with the segment analyses they reference, and the changes are the
 * same.
 *
 * @returns The changes, or `undefined` when the draft already reads as re-anchored.
 */
export function reanchorChangesForBook(
  draft: DraftProject,
  book: ReadonlyBook,
): ChangeSet | undefined {
  return changesOfPass(draft, reanchorDraftToBook(book));
}
