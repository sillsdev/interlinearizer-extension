import type { Book, SegmentationDelta } from 'interlinearizer';
import { buildBookIndexes } from '../../utils/book-indexes';
import { phrasesStraddlingBoundary } from '../../utils/phrase-arc';
import {
  isEmptyDelta,
  mergeSegments as mergeSegmentsDelta,
  moveBoundary as moveBoundaryDelta,
  splitSegmentBefore,
} from '../../utils/segmentation';
import type { ChangeBuffer } from './changeBuffer';
import { splitPhrase } from './phraseCommands';

/** What every boundary edit needs. */
type BoundaryEdit = {
  /**
   * The book the boundary falls in, tokenized one segment per verse, as the text is now. The edit
   * reads it without changing it.
   */
  verseBook: Book;
};

/** What a boundary edit that may break phrases needs. */
type PhraseBreakingEdit = BoundaryEdit & {
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
  /** Makes a fresh id each time it is called, for a record the edit may make. */
  newId: () => string;
};

/** What merging a segment into the one before it needs. */
export type MergeSegmentsRequest = BoundaryEdit & {
  /** `Token.ref` of the first token of the segment absorbed into the one before it. */
  secondSegmentStartRef: string;
};

/** What splitting a segment before a token needs. */
export type SplitSegmentRequest = PhraseBreakingEdit & {
  /** `Token.ref` of the token the new segment begins with. */
  tokenRef: string;
};

/** What moving a segment boundary from one token to another needs. */
export type MoveBoundaryRequest = PhraseBreakingEdit & {
  /** `Token.ref` of the token that stops beginning a segment. */
  fromRef: string;
  /** `Token.ref` of the token that begins a segment instead. */
  toRef: string;
};

/** Whether two boundary deltas set the same boundaries, entry for entry. */
function sameSegmentation(
  a: SegmentationDelta | undefined,
  b: SegmentationDelta | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.removedVerseStarts.length === b.removedVerseStarts.length &&
    a.removedVerseStarts.every((ref, i) => ref === b.removedVerseStarts[i]) &&
    a.addedStarts.length === b.addedStarts.length &&
    a.addedStarts.every(
      (start, i) =>
        start.tokenRef === b.addedStarts[i].tokenRef &&
        start.surfaceText === b.addedStarts[i].surfaceText,
    )
  );
}

/**
 * Stages the boundaries `transform` makes of the draft's boundaries. A result that leaves every
 * book on the default verse segmentation clears the draft's boundaries. Nothing is staged when the
 * boundaries come out as they were.
 */
async function stageSegmentation(
  buffer: ChangeBuffer,
  transform: (current: SegmentationDelta | undefined) => SegmentationDelta,
): Promise<void> {
  const { segmentation, ...scope } = await buffer.getScope();
  const transformed = transform(segmentation);
  const next = isEmptyDelta(transformed) ? undefined : transformed;
  if (sameSegmentation(next, segmentation)) return;
  buffer.putScope(next ? { ...scope, segmentation: next } : scope);
}

/**
 * Splits every approved phrase that a boundary before `boundaryRef` would cut, so that no phrase
 * spans two segments. A phrase is cut when it has tokens both before the boundary and at or after
 * it, in document order. Each piece lands wholly on its own side. Phrases are broken in id order.
 */
async function breakStraddledPhrases(
  buffer: ChangeBuffer,
  boundaryRef: string,
  { verseBook, now, newId }: PhraseBreakingEdit,
): Promise<void> {
  const { tokenDocOrder, fullTokenOrder } = buildBookIndexes(verseBook.segments);
  const { phraseAnalysisLinks } = await buffer.findLinksInBooks([verseBook.bookRef], ['approved']);
  const byId = [...phraseAnalysisLinks].sort((a, b) => a.id.localeCompare(b.id));
  const straddled = phrasesStraddlingBoundary(boundaryRef, byId, fullTokenOrder);
  await straddled.reduce(async (previous, { link, splitAfterTokenRef }) => {
    await previous;
    await splitPhrase(buffer, {
      phraseId: link.id,
      splitAfterTokenRef,
      tokenDocOrder,
      now,
      forkId: newId(),
      linkId: newId(),
      analysisId: newId(),
    });
  }, Promise.resolve());
}

/**
 * Stages merging a segment into the one before it. A segment with no verse text directly before it,
 * such as the book's first or one after a heading, is left as it is. No phrase is broken, because
 * removing a boundary cuts none.
 */
export async function mergeSegments(
  buffer: ChangeBuffer,
  { verseBook, secondSegmentStartRef }: MergeSegmentsRequest,
): Promise<void> {
  await stageSegmentation(buffer, (current) =>
    mergeSegmentsDelta(verseBook, current, secondSegmentStartRef),
  );
}

/**
 * Stages splitting a segment so that a new one begins at `tokenRef`. Every approved phrase the new
 * boundary would cut is split first, in the same edit. A token that already begins a segment leaves
 * the boundaries as they are.
 */
export async function splitSegment(
  buffer: ChangeBuffer,
  { tokenRef, ...edit }: SplitSegmentRequest,
): Promise<void> {
  await breakStraddledPhrases(buffer, tokenRef, edit);
  await stageSegmentation(buffer, (current) =>
    splitSegmentBefore(edit.verseBook, current, tokenRef),
  );
}

/**
 * Stages moving a segment boundary from `fromRef` to `toRef`, as pulling an edge token across a
 * boundary does. Every approved phrase a boundary before `toRef` would cut is split first, in the
 * same edit.
 */
export async function moveBoundary(
  buffer: ChangeBuffer,
  { fromRef, toRef, ...edit }: MoveBoundaryRequest,
): Promise<void> {
  await breakStraddledPhrases(buffer, toRef, edit);
  await stageSegmentation(buffer, (current) =>
    moveBoundaryDelta(edit.verseBook, current, fromRef, toRef),
  );
}
