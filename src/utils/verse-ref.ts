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
 * Whether `segment`'s verse range contains the verse named by `scrRef`. Containment is verse-level:
 * the segment contains the verse when the verse falls between the segment's start and end
 * references (inclusive, ordered by chapter then verse) in the same book. Character anchors are
 * ignored — after a mid-verse split, every portion of the split verse "contains" it. Used wherever
 * a verse must resolve to the segment that owns it (navigation, active highlight), since after a
 * merge or split a segment's start verse alone no longer identifies every verse it covers.
 *
 * @param segment - The segment whose verse range to test.
 * @param scrRef - Verse coordinate in the platform's `SerializedVerseRef` shape.
 * @returns `true` when the verse lies within the segment's range.
 */
export function segmentContainsVerse(segment: Segment, scrRef: SerializedVerseRef): boolean {
  if (segment.startRef.book !== scrRef.book) return false;
  const afterStart =
    scrRef.chapterNum > segment.startRef.chapter ||
    (scrRef.chapterNum === segment.startRef.chapter && scrRef.verseNum >= segment.startRef.verse);
  const beforeEnd =
    scrRef.chapterNum < segment.endRef.chapter ||
    (scrRef.chapterNum === segment.endRef.chapter && scrRef.verseNum <= segment.endRef.verse);
  return afterStart && beforeEnd;
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
