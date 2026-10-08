import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment } from 'interlinearizer';
import { bookOfRef } from './analysis-book';
import { verseOfTokenRef } from './reanchor-analysis';
import { segmentContainsVerse, verseOfId } from './verse-ref';

/** A free translation whose segment's text has changed since it was written. */
export type StaleFreeTranslation = Readonly<{
  analysisId: string;
  /** The segment it was written for, which may no longer exist. */
  segmentId: string;
  /** Its text in the active analysis language, `''` where it has none there. */
  text: string;
}>;

/**
 * Picks the stale translation a segment's free-translation input starts from: its only one, where
 * that has text and the segment holds no approved translation, else `undefined`.
 */
export function adoptedStaleTranslation(
  stale: readonly StaleFreeTranslation[],
  hasApproved: boolean,
): StaleFreeTranslation | undefined {
  return !hasApproved && stale.length === 1 && stale[0].text !== '' ? stale[0] : undefined;
}

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
 * Reads the places a vanished heading's translation falls back to: its verse's heading of the same
 * marker, else its verse, else `undefined` for an id naming no heading or a verse the book lacks. A
 * heading id is its verse's SID and marker joined by `/`, with any ordinal after `#`.
 */
function vanishedHeadingPlaces(
  headingId: string,
  placesByVerse: ReadonlyMap<string, Place[]>,
): Place[] | undefined {
  const slash = headingId.indexOf('/');
  if (slash === -1) return undefined;
  return (
    placesByVerse.get(headingId.replace(/#\d+$/, '')) ??
    placesByVerse.get(headingId.slice(0, slash))
  );
}

/** A place with the chapter and first verse number of the verse it falls in. */
type VersePlace = Readonly<{ place: Place; chapterNum: number; verseNum: number }>;

/** Lists every place in the book in document order, each with the verse it falls in. */
function placesInDocumentOrder(placesByVerse: ReadonlyMap<string, Place[]>): VersePlace[] {
  return [...placesByVerse]
    .flatMap(([verse, places]) => {
      const { chapterNum, verseNum } = verseOfId(verse);
      return places.map((place) => ({ place, chapterNum, verseNum }));
    })
    .sort((a, b) => a.place.order - b.place.order);
}

/**
 * Picks the place a translation of a verse the book no longer holds falls back to: the last place
 * of the nearest earlier verse, else the book's first place, else `undefined` for a book with
 * none.
 */
function placeBefore(verse: string, inOrder: readonly VersePlace[]): Place | undefined {
  const { chapterNum, verseNum } = verseOfId(verse);
  const isEarlier = (entry: VersePlace) =>
    entry.chapterNum < chapterNum || (entry.chapterNum === chapterNum && entry.verseNum < verseNum);
  return (inOrder.findLast(isEarlier) ?? inOrder[0])?.place;
}

/**
 * Files each of the book's stale free translations under the segment that shows it: the segment it
 * was written for, or, where that segment has since vanished, the one now covering the position it
 * began at. A vanished heading's translation goes to its verse's heading of the same marker, else
 * the start of its verse. A translation whose verse the book no longer holds goes to the segment
 * ending the nearest earlier verse, else to the book's first segment. Each segment's list runs in
 * document order of those positions.
 */
export function placeStaleFreeTranslations(
  stale: readonly StaleFreeTranslation[],
  book: Book,
): ReadonlyMap<string, readonly StaleFreeTranslation[]> {
  const placesByVerse = indexPlacesByVerse(book);
  let inOrder: readonly VersePlace[] | undefined;
  const placed = stale.flatMap((translation) => {
    if (bookOfRef(translation.segmentId) !== book.bookRef) return [];
    const { verse, offset } = positionOf(translation.segmentId);
    const places = placesByVerse.get(verse) ?? vanishedHeadingPlaces(verse, placesByVerse);
    const covering = places
      ? (places.findLast((place) => place.offset <= offset) ?? places[0])
      : placeBefore(verse, (inOrder ??= placesInDocumentOrder(placesByVerse)));
    return covering ? [{ translation, covering }] : [];
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

/**
 * Finds the first of `segmentIds` after the reader's place in `book`, wrapping around to the book's
 * first of them, or `undefined` when the book holds none. The reader is at the segment
 * `landedSegmentId` names, else at the segment holding `focusedTokenRef`, else at the first holding
 * `scrRef`'s verse, else ahead of the whole book.
 */
export function nextSegmentAmong(
  book: Book,
  segmentIds: readonly string[],
  focusedTokenRef: string | undefined,
  scrRef: SerializedVerseRef,
  landedSegmentId?: string,
): Segment | undefined {
  const { segments } = book;
  let readerIndex = segments.findIndex((segment) => segment.id === landedSegmentId);
  if (readerIndex === -1)
    readerIndex = segments.findIndex((segment) =>
      segment.tokens.some((token) => token.ref === focusedTokenRef),
    );
  if (readerIndex === -1)
    readerIndex = segments.findIndex((segment) => segmentContainsVerse(segment, scrRef));
  const wanted = new Set(segmentIds);
  return (
    segments.find((segment, index) => index > readerIndex && wanted.has(segment.id)) ??
    segments.find((segment) => wanted.has(segment.id))
  );
}
