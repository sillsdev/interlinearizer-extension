import type { Book } from 'interlinearizer';
import { bookOfRef } from './analysis-book';
import { verseOfTokenRef } from './reanchor-analysis';

/** A free translation whose segment's text has changed since it was written. */
export type StaleFreeTranslation = Readonly<{
  analysisId: string;
  /** The segment it was written for, which may no longer exist. */
  segmentId: string;
  /** Its text in the active analysis language, `''` where it has none there. */
  text: string;
}>;

/** Where a token, or a verse holding none, sits in the book. */
type Place = Readonly<{
  /** Character offset within its verse, `0` for a verse holding no tokens. */
  offset: number;
  segmentId: string;
  /** Position in the book's document order. */
  order: number;
}>;

/**
 * Reads the verse and character offset a segment id names: a segment begun at a verse is named by
 * the verse's SID, and one begun mid-verse by its first token's ref, one `:`-separated part
 * longer.
 */
function positionOf(segmentId: string): { verse: string; offset: number } {
  const refPart = segmentId.slice(segmentId.indexOf(' ') + 1);
  if (refPart.split(':').length < 3) return { verse: segmentId, offset: 0 };
  const verse = verseOfTokenRef(segmentId);
  return { verse, offset: Number(segmentId.slice(verse.length + 1)) };
}

/**
 * Indexes the book's tokens by the verse their refs name, each list in document order, and each
 * verse holding no tokens by its segment alone.
 */
function indexPlacesByVerse(book: Book): ReadonlyMap<string, Place[]> {
  const byVerse = new Map<string, Place[]>();
  let order = 0;
  const add = (verse: string, offset: number, segmentId: string) => {
    const places = byVerse.get(verse) ?? [];
    places.push({ offset, segmentId, order });
    byVerse.set(verse, places);
    order += 1;
  };
  book.segments.forEach((segment) => {
    // A tokenless segment is a whole empty verse, named by its SID.
    if (segment.tokens.length === 0) add(segment.id, 0, segment.id);
    segment.tokens.forEach((token) => {
      const verse = verseOfTokenRef(token.ref);
      add(verse, Number(token.ref.slice(verse.length + 1)), segment.id);
    });
  });
  return byVerse;
}

/**
 * Files each of the book's stale free translations under the segment that shows it: the segment it
 * was written for, or, where that segment has since vanished, the one now covering the position it
 * began at. Each segment's list runs in document order of those positions.
 *
 * A translation whose verse the book no longer holds at all is shown nowhere.
 */
export function placeStaleFreeTranslations(
  stale: readonly StaleFreeTranslation[],
  book: Book,
): ReadonlyMap<string, readonly StaleFreeTranslation[]> {
  const placesByVerse = indexPlacesByVerse(book);
  const placed = stale.flatMap((translation) => {
    if (bookOfRef(translation.segmentId) !== book.bookRef) return [];
    const { verse, offset } = positionOf(translation.segmentId);
    const places = placesByVerse.get(verse);
    if (!places) return [];
    const covering = places.findLast((place) => place.offset <= offset) ?? places[0];
    return [{ translation, covering }];
  });

  const bySegment = new Map<string, StaleFreeTranslation[]>();
  placed
    .toSorted((a, b) => a.covering.order - b.covering.order)
    .forEach(({ translation, covering }) => {
      const list = bySegment.get(covering.segmentId) ?? [];
      list.push(translation);
      bySegment.set(covering.segmentId, list);
    });
  return bySegment;
}
