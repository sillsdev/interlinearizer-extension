import type { TextAnalysis } from 'interlinearizer';
import type { DraftContent } from '../../types/draft-content';
import type { AnalysisRepository, ScopeRecord } from '../../types/analysis-repository';
import { emptyAnalysis } from '../../types/empty-factories';
import {
  booksLinkedIn,
  bookOfRef,
  mergeAnalyses,
  removeBookFromAnalysis,
  restoreBookInAnalysis,
  restoreBookInSegmentation,
  splitAnalysisByBook,
} from '../../utils/analysis-book';
import { deepEqual } from '../../utils/analysis-identity';
import { sameSegmentation, segmentationForBook } from '../../utils/segmentation';
import type { ChangeBuffer, RecordKind, RecordOf } from './changeBuffer';

/** What the project that a draft saves to holds, as a discard restores that project. */
export type SavedProject = DraftContent & Readonly<{ analysisLanguages: readonly string[] }>;

/** The reads of the stored draft that a discard stages from. */
export type DiscardReader = Pick<
  AnalysisRepository,
  | 'getScope'
  | 'getDraftState'
  | 'getTokenAnalyses'
  | 'getPhraseAnalyses'
  | 'getSegmentAnalyses'
  | 'findLinksInBooks'
  | 'findLinksToAnalyses'
  | 'findLinkedBooks'
  | 'findUnlinkedPayloads'
>;

/** What an unsaved-change discard tells its caller beside the changes it staged. */
export type DiscardOutcome = {
  /** Books whose links or boundaries the discard rewrote, which want re-anchoring to their text. */
  changedBooks: string[];
};

/**
 * The part of the stored draft that a discard can change: its own record, the records in
 * `analysis`, and the books whose stored analysis could not be read.
 */
type StoredPart = {
  scope: ScopeRecord;
  analysis: TextAnalysis;
  unreadableBooks: string[];
};

/** The records of `links`, each once, with the payloads stored under `payloadIds`. */
async function readRecords(
  reader: DiscardReader,
  links: readonly Pick<
    TextAnalysis,
    'tokenAnalysisLinks' | 'phraseAnalysisLinks' | 'segmentAnalysisLinks'
  >[],
  payloadIds: string[],
): Promise<TextAnalysis> {
  const [tokenAnalyses, phraseAnalyses, segmentAnalyses] = await Promise.all([
    reader.getTokenAnalyses(payloadIds),
    reader.getPhraseAnalyses(payloadIds),
    reader.getSegmentAnalyses(payloadIds),
  ]);
  const once = <T extends { id: string }>(records: T[]): T[] => [
    ...new Map(records.map((record) => [record.id, record])).values(),
  ];
  return {
    tokenAnalyses,
    phraseAnalyses,
    segmentAnalyses,
    tokenAnalysisLinks: once(links.flatMap((part) => part.tokenAnalysisLinks)),
    phraseAnalysisLinks: once(links.flatMap((part) => part.phraseAnalysisLinks)),
    segmentAnalysisLinks: once(links.flatMap((part) => part.segmentAnalysisLinks)),
  };
}

/** The ids of the payloads that `analysis` holds or that its links name. */
function payloadIdsOf(analysis: TextAnalysis): string[] {
  return [
    ...analysis.tokenAnalyses,
    ...analysis.phraseAnalyses,
    ...analysis.segmentAnalyses,
    ...analysis.tokenAnalysisLinks.map(({ analysisId }) => ({ id: analysisId })),
    ...analysis.phraseAnalysisLinks.map(({ analysisId }) => ({ id: analysisId })),
    ...analysis.segmentAnalysisLinks.map(({ analysisId }) => ({ id: analysisId })),
  ].map(({ id }) => id);
}

/**
 * Reads what discarding `bookCode` can change: the book's links, the payloads they name or `saved`
 * holds for the book, and every link to those payloads.
 */
async function readBookPart(
  reader: DiscardReader,
  bookCode: string,
  saved: TextAnalysis | undefined,
): Promise<StoredPart> {
  const [scope, { unreadableBooks }, bookLinks] = await Promise.all([
    reader.getScope(),
    reader.getDraftState(),
    reader.findLinksInBooks([bookCode]),
  ]);
  const savedBook = (saved && splitAnalysisByBook(saved).get(bookCode)) ?? emptyAnalysis();
  const payloadIds = [
    ...new Set([...payloadIdsOf({ ...emptyAnalysis(), ...bookLinks }), ...payloadIdsOf(savedBook)]),
  ];
  const linksToPayloads = await reader.findLinksToAnalyses(payloadIds);
  return {
    scope,
    analysis: await readRecords(reader, [bookLinks, linksToPayloads], payloadIds),
    unreadableBooks,
  };
}

/** Reads every stored record, without any single read spanning the draft. */
async function readWhole(reader: DiscardReader): Promise<StoredPart> {
  const [scope, { unreadableBooks }, linkedBooks, unlinked] = await Promise.all([
    reader.getScope(),
    reader.getDraftState(),
    reader.findLinkedBooks(),
    reader.findUnlinkedPayloads(),
  ]);
  const books = await Promise.all(
    linkedBooks.map(async (bookCode) => {
      const links = await reader.findLinksInBooks([bookCode]);
      return readRecords(reader, [links], payloadIdsOf({ ...emptyAnalysis(), ...links }));
    }),
  );
  return {
    scope,
    analysis: mergeAnalyses([...books, { ...emptyAnalysis(), ...unlinked }]),
    unreadableBooks,
  };
}

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
  const puts = target.filter((record) => !deepEqual(before.get(record.id), record));
  puts.forEach((record) => buffer.put(kind, record));
  current.filter(({ id }) => !kept.has(id)).forEach((record) => buffer.delete(kind, record));
  return puts;
}

/**
 * Stages turning the stored part's content into `restored`, as saving `restored` would store it: a
 * book whose stored analysis could not be read keeps it as stored. The draft takes
 * `restoredLanguages` as its analysis languages when they are given.
 */
function stageDiscard(
  buffer: ChangeBuffer,
  { scope: stored, analysis: current, unreadableBooks }: StoredPart,
  restored: DraftContent,
  restoredLanguages?: readonly string[],
): DiscardOutcome {
  const target: TextAnalysis = unreadableBooks.reduce(
    (analysis, bookCode) => removeBookFromAnalysis(analysis, bookCode),
    restored.analysis,
  );
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
  const segmentationChanged = !sameSegmentation(stored.segmentation, restored.segmentation);
  const languagesChanged =
    restoredLanguages !== undefined && !deepEqual(stored.analysisLanguages, restoredLanguages);
  if (segmentationChanged || languagesChanged) {
    const scope = { ...stored };
    if (restored.segmentation) scope.segmentation = restored.segmentation;
    else delete scope.segmentation;
    if (restoredLanguages) scope.analysisLanguages = [...restoredLanguages];
    buffer.putScope(scope);
  }
  if (segmentationChanged) {
    const anchoredBooks = [stored.segmentation, restored.segmentation].flatMap((delta) =>
      [
        ...(delta?.removedVerseStarts ?? []),
        ...(delta?.addedStarts ?? []).map(({ tokenRef }) => tokenRef),
      ].map(bookOfRef),
    );
    new Set(anchoredBooks).forEach((bookCode) => {
      const before = segmentationForBook(stored.segmentation, bookCode);
      if (!sameSegmentation(before, segmentationForBook(restored.segmentation, bookCode)))
        changedBooks.add(bookCode);
    });
  }

  return { changedBooks: [...changedBooks].sort() };
}

/**
 * Stages discarding the unsaved changes to one book of the stored draft. The book's records and
 * boundaries become those of `saved`, or none without it. A payload the book shares with another
 * book keeps its stored version. The draft keeps its analysis languages, because they span every
 * book. A book whose stored analysis could not be read keeps it.
 *
 * @param buffer - Where the changes are staged.
 * @param reader - Reads the stored draft.
 * @param bookCode - The book discarded.
 * @param saved - The project that the draft saves to; absent when it has no project.
 * @throws Whatever reading the stored draft throws.
 */
export async function discardBook(
  buffer: ChangeBuffer,
  reader: DiscardReader,
  bookCode: string,
  saved: SavedProject | undefined,
): Promise<DiscardOutcome> {
  const stored = await readBookPart(reader, bookCode, saved?.analysis);
  return stageDiscard(buffer, stored, {
    analysis: restoreBookInAnalysis(stored.analysis, saved?.analysis, bookCode),
    segmentation: restoreBookInSegmentation(
      stored.scope.segmentation,
      saved?.segmentation,
      bookCode,
    ),
  });
}

/**
 * Stages discarding every unsaved change to the stored draft. Its records, boundaries, and analysis
 * languages become those of `saved`. Without `saved`, it has no records or boundaries, and keeps
 * its languages. A book whose stored analysis could not be read keeps it.
 *
 * @param buffer - Where the changes are staged.
 * @param reader - Reads the stored draft.
 * @param saved - The project that the draft saves to; absent when it has no project.
 * @throws Whatever reading the stored draft throws.
 */
export async function discardAll(
  buffer: ChangeBuffer,
  reader: DiscardReader,
  saved: SavedProject | undefined,
): Promise<DiscardOutcome> {
  return stageDiscard(
    buffer,
    await readWhole(reader),
    saved ?? { analysis: emptyAnalysis(), segmentation: undefined },
    saved?.analysisLanguages,
  );
}
