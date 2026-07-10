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
  const match = /^(\d+)(?:-(\d+))?/.exec(verseStartNumber);
  if (!match) return false;
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  return verseNum >= first && verseNum <= last;
}

/**
 * Whether `segment` contains the verse named by `scrRef`. Containment is verse-level and tested
 * against the segment's `verseStarts` — the exact set of source verses it covers — rather than a
 * lexicographic `startRef`..`endRef` interval. This matters for a cross-chapter merge (e.g. a
 * segment spanning `1:2`..`2:1`): the interval would over-claim every verse in the start chapter
 * above `2` (including phantom verses past that chapter's real end that the host's next-verse
 * button can over-shoot to), whereas the covered-verse set claims only `1:2` and `2:1`. Character
 * anchors are ignored — after a mid-verse split, every portion of the split verse carries that
 * verse's start, so each portion "contains" it. Used wherever a verse must resolve to the segment
 * that owns it (navigation, active highlight), since after a merge or split a segment's start verse
 * alone no longer identifies every verse it covers.
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
