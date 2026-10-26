import type { Book, DraftProject, SegmentAnalysisLink } from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { emptyAnalysis } from '../types/empty-factories';
import { booksLinkedIn } from '../utils/analysis-book';
import { applyChangeSet, mergeChangeSets } from '../utils/change-set';
import { reanchorChangesForBook } from '../utils/reanchor-changes';
import type { ReanchorBooks } from './editHistory';

/**
 * The stored draft as a pass over `bookCodes` needs it: the draft's record, the links into those
 * books, and the segment analyses those links reference, along with those `alsoLinked` names. Reads
 * one call at a time, since calls for one draft must not overlap.
 *
 * @param alsoLinked - Segment links not yet stored, whose payloads the pass will compare against.
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

/**
 * Re-anchors the stored draft to `book`'s current text, outside any undo history and leaving the
 * draft as saved or unsaved as it was, since a pass is bookkeeping rather than an edit. A book the
 * text lacks is passed as a book with no segments.
 *
 * @returns The changes applied, or `undefined` when the draft already read as re-anchored.
 * @throws Whatever reading the draft or applying the changes throws; nothing is applied.
 */
export async function reanchorStoredBook(
  repository: AnalysisRepository,
  book: Book,
): Promise<ChangeSet | undefined> {
  const changes = reanchorInTurn(await readBooks(repository, [book.bookRef]), [book]);
  if (changes) await repository.apply(changes, { keepDirty: true });
  return changes;
}

/** Re-anchors what an undo or redo would restore in `repository`, for an {@link EditHistory}. */
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

/**
 * Which of `bookCodes` the stored draft links into.
 *
 * @throws Whatever reading the draft throws.
 */
export async function booksLinkedAmong(
  repository: AnalysisRepository,
  bookCodes: string[],
): Promise<string[]> {
  const links = await repository.findLinksInBooks(bookCodes);
  return [...booksLinkedIn({ ...emptyAnalysis(), ...links })];
}
