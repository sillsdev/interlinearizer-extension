import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment } from 'interlinearizer';
import type { PlacedFreeTranslations } from '../types/segment-pages';
import { bookOfRef } from './analysis-book';
import { verseOfTokenRef } from './reanchor-analysis';
import { positionOf, segmentContainsVerse, verseLabelCovers, verseOfId } from './verse-ref';

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

/**
 * Finds the start of the verse now holding a vanished verse's first verse, as `GEN 1:3-4` holds
 * `GEN 1:4`, else `undefined` where no verse of the book holds it.
 */
function coveringVerseStart(
  verse: string,
  placesByVerse: ReadonlyMap<string, Place[]>,
): Place | undefined {
  const { chapterNum, verseNum } = verseOfId(verse);
  const covering = [...placesByVerse].find(
    ([key]) =>
      !key.includes('/') &&
      verseOfId(key).chapterNum === chapterNum &&
      verseLabelCovers(key.slice(key.indexOf(':') + 1), verseNum),
  );
  return covering?.[1][0];
}

/** A place, with the chapter and verse it falls in. */
type VersePlace = Readonly<{
  place: Place;
  chapterNum: number;
  /** Its verse number, a bridged verse's first. */
  verseNum: number;
}>;

/** Lists every place in the book in document order, each with the verse it falls in. */
function placesInDocumentOrder(placesByVerse: ReadonlyMap<string, Place[]>): VersePlace[] {
  return [...placesByVerse]
    .flatMap(([verse, places]) => {
      const { chapterNum, verseNum } = verseOfId(verse);
      return places.map((place) => ({ place, chapterNum, verseNum }));
    })
    .sort((a, b) => a.place.order - b.place.order);
}

/** Finds the last place of the nearest earlier verse, `undefined` where none precedes it. */
function placeBefore(
  { chapterNum, verseNum }: SerializedVerseRef,
  inOrder: readonly VersePlace[],
): Place | undefined {
  const isEarlier = (entry: VersePlace) =>
    entry.chapterNum < chapterNum || (entry.chapterNum === chapterNum && entry.verseNum < verseNum);
  return inOrder.findLast(isEarlier)?.place;
}

/** Reads the chapter and verse a segment id falls in, e.g. `1:5` or `1:5-6`. */
export function verseLabelOf(segmentId: string): string {
  const { verse } = positionOf(segmentId);
  return verse.slice(verse.indexOf(' ') + 1).replace(/\/.*$/, '');
}

/** A book's stale free translations, filed by where the view shows each. */
export type PlacedStaleFreeTranslations = Readonly<{
  /** Those each segment reviews beside its own translation, by segment id, in document order. */
  bySegment: ReadonlyMap<string, readonly StaleFreeTranslation[]>;
  /**
   * Those of verses the book no longer holds, by the id of the segment ending the nearest earlier
   * verse, in verse order.
   */
  orphanedAfter: ReadonlyMap<string, readonly StaleFreeTranslation[]>;
  /** Those of verses the book no longer holds that ran ahead of every verse it does. */
  orphanedAhead: readonly StaleFreeTranslation[];
}>;

/** Stale free translations by where the view places them, each as `T`. */
type Placement<T> = Readonly<{
  bySegment: ReadonlyMap<string, readonly T[]>;
  orphanedAfter: ReadonlyMap<string, readonly T[]>;
  orphanedAhead: readonly T[];
}>;

/**
 * The stale free translations that `placement` puts beside the segments `segmentIds`, each named by
 * `idOf`. Those ahead of every verse come only when `isFirstPage`.
 */
export function placedAmong<T>(
  placement: Placement<T>,
  segmentIds: readonly string[],
  isFirstPage: boolean,
  idOf: (translation: T) => string,
): PlacedFreeTranslations {
  const bySegment: Record<string, readonly string[]> = {};
  const orphanedAfter: Record<string, readonly string[]> = {};
  segmentIds.forEach((id) => {
    const reviewed = placement.bySegment.get(id);
    if (reviewed) bySegment[id] = reviewed.map(idOf);
    const orphaned = placement.orphanedAfter.get(id);
    if (orphaned) orphanedAfter[id] = orphaned.map(idOf);
  });
  return {
    bySegment,
    orphanedAfter,
    orphanedAhead: isFirstPage ? placement.orphanedAhead.map(idOf) : [],
  };
}

/** The payload ids of every stale free translation in `placement`. */
export function placedIdsIn(placement: PlacedFreeTranslations): Set<string> {
  return new Set(
    [
      ...Object.values(placement.bySegment),
      ...Object.values(placement.orphanedAfter),
      placement.orphanedAhead,
    ].flat(),
  );
}

/**
 * How many orphaned free-translation cards the view shows beside segment `segmentId`, which sits at
 * outline `index`. The first segment also shows the cards of verses that ran ahead of every verse
 * the book holds.
 */
export function orphanedCardCountAt(
  placed: Pick<PlacedStaleFreeTranslations, 'orphanedAfter' | 'orphanedAhead'>,
  segmentId: string,
  index: number,
): number {
  return (
    (index === 0 ? placed.orphanedAhead.length : 0) +
    (placed.orphanedAfter.get(segmentId)?.length ?? 0)
  );
}

function fileUnder(
  map: Map<string, StaleFreeTranslation[]>,
  key: string,
  translation: StaleFreeTranslation,
) {
  const list = map.get(key) ?? [];
  list.push(translation);
  map.set(key, list);
}

/**
 * Files each of the book's stale free translations where the view shows it. One whose segment still
 * stands goes to that segment, and one whose segment has since vanished to the segment now covering
 * the position it began at. A vanished heading's translation goes to its verse's heading of the
 * same marker, else the start of its verse. One whose verse the book holds only under another verse
 * marker, joined into a bridge or split out of one, goes to the start of that marker's verse. A
 * translation whose verse the book no longer holds is orphaned, following the segment that ends the
 * nearest earlier verse.
 */
export function placeStaleFreeTranslations(
  stale: readonly StaleFreeTranslation[],
  book: Book,
): PlacedStaleFreeTranslations {
  const placesByVerse = indexPlacesByVerse(book);
  let inOrder: readonly VersePlace[] | undefined;
  const placed: { translation: StaleFreeTranslation; covering: Place }[] = [];
  const orphaned: {
    translation: StaleFreeTranslation;
    after: Place | undefined;
    verse: SerializedVerseRef;
  }[] = [];
  stale.forEach((translation) => {
    if (bookOfRef(translation.segmentId) !== book.bookRef) return;
    const { verse, offset } = positionOf(translation.segmentId);
    const places = placesByVerse.get(verse) ?? vanishedHeadingPlaces(verse, placesByVerse);
    // An offset names no position in a verse its own has since been bridged into or split from.
    const covering = places
      ? (places.findLast((place) => place.offset <= offset) ?? places[0])
      : coveringVerseStart(verse, placesByVerse);
    if (covering) {
      placed.push({ translation, covering });
      return;
    }
    inOrder ??= placesInDocumentOrder(placesByVerse);
    // A book holding no text has nothing to show an orphan beside.
    if (inOrder.length === 0) return;
    const verseRef = verseOfId(verse);
    orphaned.push({ translation, after: placeBefore(verseRef, inOrder), verse: verseRef });
  });

  const bySegment = new Map<string, StaleFreeTranslation[]>();
  placed
    .toSorted((a, b) => a.covering.order - b.covering.order)
    .forEach(({ translation, covering }) => fileUnder(bySegment, covering.segmentId, translation));

  const orphanedAfter = new Map<string, StaleFreeTranslation[]>();
  const orphanedAhead: StaleFreeTranslation[] = [];
  orphaned
    .toSorted(
      (a, b) => a.verse.chapterNum - b.verse.chapterNum || a.verse.verseNum - b.verse.verseNum,
    )
    .forEach(({ translation, after }) => {
      if (after) fileUnder(orphanedAfter, after.segmentId, translation);
      else orphanedAhead.push(translation);
    });

  return { bySegment, orphanedAfter, orphanedAhead };
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
