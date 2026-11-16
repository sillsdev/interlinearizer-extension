import type { DraftProject, ReadonlyBook, SegmentAnalysisLink } from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { emptyAnalysis } from '../types/empty-factories';
import { booksLinkedIn } from '../utils/analysis-book';
import { applyChangeSet, mergeChangeSets } from '../utils/change-set';
import { reanchorChangesForBook } from '../utils/reanchor-changes';
import { segmentationForBook } from '../utils/segmentation';
import type { AppliedChange } from './analysisChanges';
import type { EditHistory, ReanchorBooks } from './editHistory';

/**
 * The stored draft as a pass over `bookCodes` needs it: the draft's record, the links into those
 * books, and the segment analyses referenced by those links or by the links in `alsoLinked`, which
 * are not yet stored. Reads one call at a time, because calls for one draft must not overlap.
 */
async function readBooks(
  repository: AnalysisRepository,
  bookCodes: string[],
  alsoLinked: readonly SegmentAnalysisLink[] = [],
): Promise<DraftProject> {
  const scope = await repository.getScope();
  const links = await repository.findLinksInBooks(bookCodes);
  const segmentAnalyses = await repository.getSegmentAnalyses([
    ...new Set([...links.segmentAnalysisLinks, ...alsoLinked].map(({ analysisId }) => analysisId)),
  ]);
  return { ...scope, dirty: false, analysis: { ...emptyAnalysis(), ...links, segmentAnalyses } };
}

/** The changes that re-anchor `draft` to each of `books` in turn, `undefined` when there are none. */
function reanchorInTurn(
  draft: DraftProject,
  books: readonly ReadonlyBook[],
): ChangeSet | undefined {
  let current = draft;
  let changes: ChangeSet | undefined;
  books.forEach((book) => {
    const bookChanges = reanchorChangesForBook(current, book);
    if (!bookChanges) return;
    current = applyChangeSet(current, bookChanges).draft;
    changes = changes ? mergeChangeSets(changes, bookChanges) : bookChanges;
  });
  return changes;
}

/**
 * Re-anchors the draft stored in `repository` to `book`'s current text, as no undo step. The pass
 * is applied and recorded through `history`, which must apply to `repository`. The draft stays as
 * saved or unsaved as it was, because a pass is bookkeeping rather than an edit.
 *
 * The pass is recorded even over a book the draft neither links into nor holds boundary edits in,
 * because an undo or redo may restore links or boundary edits there. A book the text lacks is
 * passed as a book with no segments.
 *
 * @returns The changes applied, with their inverse: the changes that undo them. `undefined` when
 *   the draft already read as re-anchored.
 * @throws Whatever reading the draft or applying the changes throws; nothing is applied or
 *   recorded.
 */
export async function reanchorStoredBook(
  repository: AnalysisRepository,
  history: EditHistory,
  book: ReadonlyBook,
): Promise<AppliedChange | undefined> {
  const draft = await readBooks(repository, [book.bookRef]);
  return history.applyPass(book, reanchorInTurn(draft, [book]));
}

/**
 * Gives the {@link ReanchorBooks} for `repository`: the changes that re-anchor what an undo or redo
 * would restore there, without applying them. Skips each book that would hold neither links nor
 * boundary edits once the changes apply.
 */
export function reanchorRestored(repository: AnalysisRepository): ReanchorBooks {
  return async (changes, books) => {
    // A restored link may name a payload no stored link does, which only the step's puts reveal.
    const stored = await readBooks(
      repository,
      books.map(({ bookRef }) => bookRef),
      changes.segmentAnalysisLinks?.puts,
    );
    const restored = applyChangeSet(stored, changes).draft;
    const linked = booksLinkedIn(restored.analysis);
    return reanchorInTurn(
      restored,
      books.filter(
        ({ bookRef }) =>
          linked.has(bookRef) || segmentationForBook(restored.segmentation, bookRef) !== undefined,
      ),
    );
  };
}
