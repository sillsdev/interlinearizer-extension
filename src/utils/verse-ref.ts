import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ScriptureRef, Segment } from 'interlinearizer';

/**
 * Whether `ref` and `scrRef` name the same verse, bridging `ScriptureRef`'s `chapter`/`verse` field
 * names to `SerializedVerseRef`'s `chapterNum`/`verseNum`.
 *
 * @param ref - Verse coordinate in the internal `ScriptureRef` shape.
 * @param scrRef - Verse coordinate in the platform's `SerializedVerseRef` shape.
 * @returns `true` when both name the same book, chapter, and verse.
 */
export function isSameVerse(ref: ScriptureRef, scrRef: SerializedVerseRef): boolean {
  return (
    ref.book === scrRef.book && ref.chapter === scrRef.chapterNum && ref.verse === scrRef.verseNum
  );
}

/**
 * Parses the leading verse range out of a verbatim USJ verse label. A plain number (e.g. `"7"`)
 * yields `{ first: 7, last: 7 }`; a hyphenated range (e.g. `"3-4"`) yields `{ first: 3, last: 4 }`.
 * A label that begins with no digits (e.g. an empty or note-only marker) yields `undefined`. Shared
 * by {@link firstVerseNumber} and {@link verseLabelCovers} so the label grammar lives in one place.
 *
 * @param verseStartNumber - The verse start's verbatim `number`.
 * @returns The label's `first`/`last` endpoints (equal for a plain number), or `undefined` when it
 *   names no verse.
 */
function parseVerseLabel(verseStartNumber: string): { first: number; last: number } | undefined {
  // Accept an ASCII hyphen or any common Unicode dash (U+2010–U+2015: hyphen, non-breaking hyphen,
  // figure/en/em dash, horizontal bar) as the range separator: while USFM ranges are conventionally
  // ASCII-hyphenated, a source rendered with a typographic dash must still resolve its later verses
  // for containment. `\uXXXX` escapes keep auto-formatters from rewriting the dash characters.
  const match = /^(\d+)(?:[-\u2010-\u2015](\d+))?/.exec(verseStartNumber);
  if (!match) return undefined;
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  return { first, last };
}

/**
 * Parses the first verse number out of a verbatim USJ verse label. A plain number returns itself; a
 * hyphenated range (e.g. `"3-4"`) returns its first endpoint. A label that begins with no digits
 * (e.g. an empty or note-only marker) returns `undefined`.
 *
 * @param verseStartNumber - The verse start's verbatim `number`.
 * @returns The label's leading verse number, or `undefined` when it names none.
 */
export function firstVerseNumber(verseStartNumber: string): number | undefined {
  return parseVerseLabel(verseStartNumber)?.first;
}

/**
 * Reports whether `verseStartNumber` (a verbatim USJ verse label, e.g. `"7"` or a range like
 * `"3-4"`) names the verse `verseNum`. A plain number matches on equality; a hyphenated range
 * matches any verse from its first to its last endpoint inclusive. A label that parses to no digits
 * matches nothing.
 *
 * @param verseStartNumber - The verse start's verbatim `number`.
 * @param verseNum - The verse number to test for membership.
 * @returns `true` when the label names `verseNum`.
 */
function verseLabelCovers(verseStartNumber: string, verseNum: number): boolean {
  const range = parseVerseLabel(verseStartNumber);
  if (!range) return false;
  return verseNum >= range.first && verseNum <= range.last;
}

/**
 * Whether `segment` contains the verse named by `scrRef`. Containment is verse-level and tested
 * against the segment's `verseStarts` — the exact set of covered source verses — rather than a
 * lexicographic `startRef`..`endRef` interval: for a cross-chapter merge (e.g. `1:2`..`2:1`) the
 * interval would over-claim every verse in the start chapter above `2`, whereas the covered-verse
 * set claims only `1:2` and `2:1`. Character anchors are ignored, so every portion of a split verse
 * "contains" it. Used wherever a verse must resolve to its owning segment (navigation, active
 * highlight).
 *
 * @param segment - The segment whose covered verses to test.
 * @param scrRef - Verse coordinate in the platform's `SerializedVerseRef` shape.
 * @returns `true` when the segment covers the verse named by `scrRef`.
 */
export function segmentContainsVerse(segment: Segment, scrRef: SerializedVerseRef): boolean {
  if (segment.startRef.book !== scrRef.book) return false;
  return segment.verseStarts.some(
    (vs) => vs.chapter === scrRef.chapterNum && verseLabelCovers(vs.number, scrRef.verseNum),
  );
}

/**
 * Converts an internal `ScriptureRef` to the platform's `SerializedVerseRef` shape, dropping any
 * character anchor.
 *
 * @param ref - Verse coordinate in the internal `ScriptureRef` shape.
 * @returns The same verse coordinate as a `SerializedVerseRef`.
 */
export function toSerializedVerseRef(ref: ScriptureRef): SerializedVerseRef {
  return { book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse };
}
