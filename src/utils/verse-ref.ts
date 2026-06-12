import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ScriptureRef } from 'interlinearizer';

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
 * Converts an internal `ScriptureRef` to the platform's `SerializedVerseRef` shape, dropping any
 * character anchor.
 *
 * @param ref - Verse coordinate in the internal `ScriptureRef` shape.
 * @returns The same verse coordinate as a `SerializedVerseRef`.
 */
export function toSerializedVerseRef(ref: ScriptureRef): SerializedVerseRef {
  return { book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse };
}
