import type { Book, DraftProject, SegmentAnalysisLink } from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { emptyAnalysis } from '../types/empty-factories';
import { booksLinkedIn } from '../utils/analysis-book';
import { applyChangeSet, mergeChangeSets } from '../utils/change-set';
import { reanchorChangesForBook } from '../utils/reanchor-changes';
import { segmentationForBook } from '../utils/segmentation';
import type { ReanchorBooks } from './editHistory';

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
function reanchorInTurn(draft: DraftProject, books: readonly Book[]): ChangeSet | undefined {
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

/** What a pass over one book of the stored draft found and applied. */
export type StoredBookPass = {
  /** Whether the draft linked into the book or held boundary edits in it before the pass. */
  heldAnalysis: boolean;
  /** The changes applied; absent when the draft already read as re-anchored. */
  changes?: ChangeSet;
};

/**
 * Re-anchors the stored draft to `book`'s current text, outside any undo history. The draft stays
 * as saved or unsaved as it was, because a pass is bookkeeping rather than an edit. A book the text
 * lacks is passed as a book with no segments.
 *
 * @throws Whatever reading the draft or applying the changes throws; nothing is applied.
 */
export async function reanchorStoredBook(
  repository: AnalysisRepository,
  book: Book,
): Promise<StoredBookPass> {
  const draft = await readBooks(repository, [book.bookRef]);
  const heldAnalysis =
    booksLinkedIn(draft.analysis).has(book.bookRef) ||
    segmentationForBook(draft.segmentation, book.bookRef) !== undefined;
  const changes = reanchorInTurn(draft, [book]);
  if (changes) await repository.apply(changes, { keepDirty: true });
  return { heldAnalysis, ...(changes && { changes }) };
}

/**
 * Gives the {@link ReanchorBooks} for `repository`: the changes that re-anchor what an undo or redo
 * would restore there, without applying them.
 */
export function reanchorRestored(repository: AnalysisRepository): ReanchorBooks {
  return async (changes, books) => {
    // A restored link may name a payload no stored link does, which only the step's puts reveal.
    const stored = await readBooks(
      repository,
      books.map(({ bookRef }) => bookRef),
      changes.segmentAnalysisLinks?.puts,
    );
    return reanchorInTurn(applyChangeSet(stored, changes).draft, books);
  };
}
