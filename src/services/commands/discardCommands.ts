import type { TextAnalysis } from 'interlinearizer';
import type { DraftContent } from '../../hooks/useDraftProject';
import type { DraftExport } from '../../types/analysis-repository';
import { emptyAnalysis } from '../../types/empty-factories';
import {
  booksLinkedIn,
  bookOfRef,
  removeBookFromAnalysis,
  restoreBookInAnalysis,
  restoreBookInSegmentation,
} from '../../utils/analysis-book';
import { scopeRecordOf } from '../../utils/change-set';
import { analysisHasFreeTranslations } from '../../utils/free-translations';
import { segmentationForBook } from '../../utils/segmentation';
import type { ChangeBuffer, RecordKind, RecordOf } from './changeBuffer';

/** What an unsaved-change discard tells its caller beside the changes it staged. */
export type DiscardOutcome = {
  /** Whether any segment of the draft, as the discard leaves it, has a free translation. */
  hasFreeTranslations: boolean;
  /** Books whose links or boundaries the discard rewrote, which want re-anchoring to their text. */
  changedBooks: string[];
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Stages the puts and removals of `kind` that turn `current`'s records into `target`'s, returning
 * the records it puts.
 */
function stageKind<Kind extends RecordKind>(
  buffer: ChangeBuffer,
  kind: Kind,
  current: readonly RecordOf<Kind>[],
  target: readonly RecordOf<Kind>[],
): RecordOf<Kind>[] {
  const before = new Map(current.map((record) => [record.id, record]));
  const kept = new Set(target.map(({ id }) => id));
  const puts = target.filter((record) => !sameJson(before.get(record.id), record));
  puts.forEach((record) => buffer.put(kind, record));
  current.filter(({ id }) => !kept.has(id)).forEach((record) => buffer.delete(kind, record));
  return puts;
}

/**
 * Stages turning the stored draft's content into `restored`, as the WebView's save of `restored`
 * would store it: a book whose stored analysis could not be read keeps it as stored.
 */
function stageDiscard(
  buffer: ChangeBuffer,
  { draft, unreadableBooks }: DraftExport,
  restored: DraftContent,
): DiscardOutcome {
  const target: TextAnalysis = unreadableBooks.reduce(
    (analysis, bookCode) => removeBookFromAnalysis(analysis, bookCode),
    restored.analysis,
  );
  const current = draft.analysis;
  stageKind(buffer, 'segmentAnalyses', current.segmentAnalyses, target.segmentAnalyses);
  stageKind(buffer, 'tokenAnalyses', current.tokenAnalyses, target.tokenAnalyses);
  stageKind(buffer, 'phraseAnalyses', current.phraseAnalyses, target.phraseAnalyses);
  const putLinks: TextAnalysis = {
    ...emptyAnalysis(),
    segmentAnalysisLinks: stageKind(
      buffer,
      'segmentAnalysisLinks',
      current.segmentAnalysisLinks,
      target.segmentAnalysisLinks,
    ),
    tokenAnalysisLinks: stageKind(
      buffer,
      'tokenAnalysisLinks',
      current.tokenAnalysisLinks,
      target.tokenAnalysisLinks,
    ),
    phraseAnalysisLinks: stageKind(
      buffer,
      'phraseAnalysisLinks',
      current.phraseAnalysisLinks,
      target.phraseAnalysisLinks,
    ),
  };

  const changedBooks = new Set(booksLinkedIn(putLinks));
  if (!sameJson(draft.segmentation, restored.segmentation)) {
    const scope = scopeRecordOf(draft);
    if (restored.segmentation) scope.segmentation = restored.segmentation;
    else delete scope.segmentation;
    buffer.putScope(scope);
    const anchoredBooks = [draft.segmentation, restored.segmentation].flatMap((delta) =>
      [
        ...(delta?.removedVerseStarts ?? []),
        ...(delta?.addedStarts ?? []).map(({ tokenRef }) => tokenRef),
      ].map(bookOfRef),
    );
    new Set(anchoredBooks).forEach((bookCode) => {
      const before = segmentationForBook(draft.segmentation, bookCode);
      if (!sameJson(before, segmentationForBook(restored.segmentation, bookCode)))
        changedBooks.add(bookCode);
    });
  }

  return {
    hasFreeTranslations: analysisHasFreeTranslations(restored.analysis),
    changedBooks: [...changedBooks].sort(),
  };
}

/**
 * Stages discarding the unsaved changes to one book of the stored draft. The book's records and
 * boundaries become those of `saved`, or none without it. A payload the book shares with another
 * book keeps its stored version.
 *
 * @param buffer - Where the changes are staged.
 * @param stored - The stored draft, with the books whose analysis could not be read; those keep
 *   their stored analysis.
 * @param bookCode - The book discarded.
 * @param saved - The content of the project that the draft saves to; absent when it has no project.
 */
export function discardBook(
  buffer: ChangeBuffer,
  stored: DraftExport,
  bookCode: string,
  saved: DraftContent | undefined,
): DiscardOutcome {
  const { analysis, segmentation } = stored.draft;
  return stageDiscard(buffer, stored, {
    analysis: restoreBookInAnalysis(analysis, saved?.analysis, bookCode),
    segmentation: restoreBookInSegmentation(segmentation, saved?.segmentation, bookCode),
  });
}

/**
 * Stages discarding every unsaved change to the stored draft. Its records and boundaries become
 * those of `saved`, or none without it.
 *
 * @param buffer - Where the changes are staged.
 * @param stored - The stored draft, with the books whose analysis could not be read; those keep
 *   their stored analysis.
 * @param saved - The content of the project that the draft saves to; absent when it has no project.
 */
export function discardAll(
  buffer: ChangeBuffer,
  stored: DraftExport,
  saved: DraftContent | undefined,
): DiscardOutcome {
  return stageDiscard(
    buffer,
    stored,
    saved ?? { analysis: emptyAnalysis(), segmentation: undefined },
  );
}
