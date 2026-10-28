import { Canon } from '@sillsdev/scripture';
import type {
  AnalysisChange,
  AnalysisLink,
  AnalysisQuery,
  Book,
  ChangedBook,
  SegmentationDelta,
  SegmentRange,
} from 'interlinearizer';
import type { AnalysisRepository, ChangeSet, RecordChanges } from '../types/analysis-repository';
import { bookOfRef } from '../utils/analysis-book';
import { bookIndexesOf } from '../utils/book-indexes';
import { segmentationForBook } from '../utils/segmentation';
import { placeStaleFreeTranslations } from '../utils/stale-free-translations';
import { touchedForms } from './sessionPages';

/** Changes as applied, with the changes that restore what they replaced. */
export type AppliedChange = Readonly<{ changes: ChangeSet; inverse: ChangeSet }>;

/**
 * Looks up a book as the session's boundaries now segment it. Answers `undefined` when the host
 * holds no outline for the book.
 */
export type HeldBook = (bookId: string) => Book | undefined;

/** Each record a kind's changes put, and each that its inverse restores. */
function touched<T>(
  changes: RecordChanges<T> | undefined,
  inverse: RecordChanges<T> | undefined,
): T[] {
  return [...(changes?.puts ?? []), ...(inverse?.puts ?? [])];
}

/** The books whose boundaries differ between two deltas. */
function booksResegmentedBetween(
  before: SegmentationDelta | undefined,
  after: SegmentationDelta | undefined,
): string[] {
  const books = new Set(
    [before, after].flatMap((delta) => [
      ...(delta?.removedVerseStarts ?? []).map(bookOfRef),
      ...(delta?.addedStarts ?? []).map(({ tokenRef }) => bookOfRef(tokenRef)),
    ]),
  );
  return [...books].filter(
    (bookId) =>
      JSON.stringify(segmentationForBook(before, bookId)) !==
      JSON.stringify(segmentationForBook(after, bookId)),
  );
}

/** The books whose boundaries an applied change moved. */
export function booksResegmented({ changes, inverse }: AppliedChange): string[] {
  return changes.scope && inverse.scope
    ? booksResegmentedBetween(inverse.scope.segmentation, changes.scope.segmentation)
    : [];
}

/**
 * The outline index of the segment at which the view shows a free translation of `segmentId`. That
 * is the segment itself when the book holds it, else the segment where a stale translation is
 * placed. `undefined` when the view would show the translation nowhere.
 */
function freeTranslationIndex(book: Book, segmentId: string): number | undefined {
  const { segmentOrder } = bookIndexesOf(book.segments);
  const own = segmentOrder.get(segmentId);
  if (own !== undefined) return own;
  const placed = placeStaleFreeTranslations([{ analysisId: '', segmentId, text: '' }], book);
  if (placed.orphanedAhead.length > 0) return 0;
  const [placedAt] = [...placed.bySegment.keys(), ...placed.orphanedAfter.keys()];
  return placedAt === undefined ? undefined : segmentOrder.get(placedAt);
}

/** Runs of consecutive indexes, in order. */
function rangesOf(indexes: ReadonlySet<number>): SegmentRange[] {
  const ranges: { start: number; end: number }[] = [];
  [...indexes]
    .sort((a, b) => a - b)
    .forEach((index) => {
      const last = ranges.at(-1);
      if (last?.end === index) last.end = index + 1;
      else ranges.push({ start: index, end: index + 1 });
    });
  return ranges;
}

/** Whether any of `analysisIds` has a stale link. */
async function anyLinkedStale(
  repository: AnalysisRepository,
  analysisIds: readonly string[],
): Promise<boolean> {
  if (analysisIds.length === 0) return false;
  const links = await repository.findLinksToAnalyses([...analysisIds]);
  return [
    ...links.tokenAnalysisLinks,
    ...links.phraseAnalysisLinks,
    ...links.segmentAnalysisLinks,
  ].some(({ status }) => status === 'stale');
}

/**
 * Describes what an applied change touched, reading `repository` as the change leaves it.
 *
 * The description names each segment on which the change put or removed links, at the place where
 * the view shows it. A book whose boundaries the change moved is named whole, as is a book that the
 * host holds no outline for. The description also names the analyses whose payloads or links the
 * change put or removed, and the cross-book queries that those analyses may change. It names the
 * forms whose pool buckets the change may have changed, too.
 *
 * @throws Whatever the repository's lookups throw.
 */
export async function describeChange(
  repository: AnalysisRepository,
  applied: AppliedChange,
  heldBook: HeldBook,
): Promise<AnalysisChange> {
  const { changes, inverse } = applied;
  const tokenPayloads = touched(changes.tokenAnalyses, inverse.tokenAnalyses);
  const tokenLinks = touched(changes.tokenAnalysisLinks, inverse.tokenAnalysisLinks);
  const phraseLinks = touched(changes.phraseAnalysisLinks, inverse.phraseAnalysisLinks);
  const segmentPayloads = touched(changes.segmentAnalyses, inverse.segmentAnalyses);
  const segmentLinks = touched(changes.segmentAnalysisLinks, inverse.segmentAnalysisLinks);
  const links: AnalysisLink[] = [...tokenLinks, ...phraseLinks, ...segmentLinks];
  const payloadIds = [
    ...tokenPayloads,
    ...touched(changes.phraseAnalyses, inverse.phraseAnalyses),
    ...segmentPayloads,
  ].map(({ id }) => id);

  const wholeBooks = new Set(booksResegmented(applied));
  const indexesByBook = new Map<string, Set<number>>();
  const books = new Map<string, Book | undefined>();
  const markAt = (bookId: string, indexOf: (book: Book) => number | undefined) => {
    if (wholeBooks.has(bookId)) return;
    if (!books.has(bookId)) books.set(bookId, heldBook(bookId));
    const book = books.get(bookId);
    if (!book) {
      wholeBooks.add(bookId);
      return;
    }
    const index = indexOf(book);
    if (index === undefined) return;
    const indexes = indexesByBook.get(bookId) ?? new Set();
    indexes.add(index);
    indexesByBook.set(bookId, indexes);
  };
  const markToken = (tokenRef: string) =>
    markAt(bookOfRef(tokenRef), (book) => {
      const { tokenSegmentMap, segmentOrder } = bookIndexesOf(book.segments);
      const segmentId = tokenSegmentMap.get(tokenRef);
      return segmentId === undefined ? undefined : segmentOrder.get(segmentId);
    });
  tokenLinks.forEach(({ token }) => markToken(token.tokenRef));
  phraseLinks.forEach(({ tokens }) => tokens.forEach(({ tokenRef }) => markToken(tokenRef)));
  segmentLinks.forEach(({ segmentId }) =>
    markAt(bookOfRef(segmentId), (book) => freeTranslationIndex(book, segmentId)),
  );

  const changedBooks: ChangedBook[] = [...new Set([...wholeBooks, ...indexesByBook.keys()])]
    .sort((a, b) => Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b))
    .map((bookId) => {
      const indexes = indexesByBook.get(bookId);
      return wholeBooks.has(bookId) || !indexes
        ? { bookId }
        : { bookId, ranges: rangesOf(indexes) };
    });

  const queries: AnalysisQuery[] = [];
  if (tokenPayloads.length > 0 || tokenLinks.length > 0)
    queries.push('getCatalogRows', 'getConcordance');
  if (
    links.some(({ status }) => status === 'stale') ||
    (await anyLinkedStale(repository, [
      ...tokenPayloads.map(({ id }) => id),
      ...segmentPayloads.map(({ id }) => id),
    ]))
  )
    queries.push('getStaleSummary');

  return {
    books: changedBooks,
    analysisIds: [...new Set([...payloadIds, ...links.map(({ analysisId }) => analysisId)])].sort(),
    forms: await touchedForms(repository, applied),
    queries,
  };
}
