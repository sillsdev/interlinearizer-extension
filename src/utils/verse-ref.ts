import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ScriptureRef, Segment } from 'interlinearizer';

/**
 * Whether the two refs name the same verse, bridging {@link ScriptureRef}'s `chapter`/`verse` field
 * names to {@link SerializedVerseRef}'s `chapterNum`/`verseNum`.
 *
 * @returns `true` when both name the same book, chapter, and verse.
 */
export function isSameVerse(ref: ScriptureRef, scrRef: SerializedVerseRef): boolean {
  return (
    ref.book === scrRef.book && ref.chapter === scrRef.chapterNum && ref.verse === scrRef.verseNum
  );
}

/**
 * Parses the leading verse range out of a verbatim USJ verse label: `"7"` yields `7`–`7` and a
 * hyphenated range `"3-4"` yields `3`–`4`. A label beginning with no digits (an empty or note-only
 * marker) yields `undefined`. The one place the label grammar is defined.
 *
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
 * The first verse number named by a verbatim USJ verse label, or `undefined` when the label names
 * no verse.
 *
 * @returns The label's leading verse number, or `undefined` when it names none.
 */
export function firstVerseNumber(verseStartNumber: string): number | undefined {
  return parseVerseLabel(verseStartNumber)?.first;
}

/**
 * Whether a verbatim USJ verse label names the given verse. A range matches any verse between its
 * endpoints inclusive; a label that parses to no digits matches nothing.
 *
 * @returns `true` when the label names `verseNum`.
 */
function verseLabelCovers(verseStartNumber: string, verseNum: number): boolean {
  const range = parseVerseLabel(verseStartNumber);
  if (!range) return false;
  return verseNum >= range.first && verseNum <= range.last;
}

/**
 * Whether the segment contains the verse named by the ref. Used wherever a verse must resolve to
 * its owning segment, such as navigation and active-verse highlighting.
 *
 * Containment is tested against the segment's covered source verses rather than a lexicographic
 * start-to-end interval: for a cross-chapter merge (say `1:2`..`2:1`) the interval would over-claim
 * every verse in the start chapter above `2`. Character anchors are ignored, so every portion of a
 * split verse contains it.
 *
 * @returns `true` when the segment covers the verse named by `scrRef`.
 */
export function segmentContainsVerse(segment: Segment, scrRef: SerializedVerseRef): boolean {
  if (segment.startRef.book !== scrRef.book) return false;
  return segment.verseStarts.some(
    (vs) => vs.chapter === scrRef.chapterNum && verseLabelCovers(vs.number, scrRef.verseNum),
  );
}

/**
 * Converts an internal {@link ScriptureRef} to the platform's {@link SerializedVerseRef} shape,
 * dropping any character anchor.
 */
export function toSerializedVerseRef(ref: ScriptureRef): SerializedVerseRef {
  return { book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse };
}
