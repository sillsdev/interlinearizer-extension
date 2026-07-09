/**
 * @file Pure helper deriving inline verse-superscript labels for a (re)segmented book.
 *
 *   Verse numbers render as inline superscripts sourced verbatim from the USJ verse marker (carried
 *   on `Segment.verseStarts`). This module decides, over the whole book in document order, which
 *   verse starts open a new chapter — those get a `chapter:number` qualifier; all others render
 *   their bare verbatim number. (The pinned "Book N" chapter header is a separate scroll-driven
 *   overlay in the list, not derived here.)
 *
 *   The chapter of a verse start is read from the embedded SID of the token at that offset (tokens
 *   carry a `ref` like `"GEN 2:1:0"` and no separate chapter field), so a chapter boundary absorbed
 *   into a merged segment is still qualified — the qualifier triggers off "verse start whose
 *   chapter exceeds every chapter seen so far", regardless of where the segment boundary falls.
 */
import type { Segment } from 'interlinearizer';

/**
 * Extracts the chapter number from a token ref's embedded SID (e.g. `2` from `"GEN 2:1:0"`).
 *
 * The ref is `"<book> <chapter>:<verse>:<charStart>"`; the chapter is the digits between the space
 * and the first colon.
 *
 * @param tokenRef - A token ref string.
 * @returns The chapter number, or `undefined` when the ref does not parse.
 */
function chapterOfTokenRef(tokenRef: string): number | undefined {
  const match = /^.+ (\d+):/.exec(tokenRef);
  /* v8 ignore next -- every tokenizer-produced ref embeds "<book> <chapter>:", so this always matches */
  if (!match) return undefined;
  return Number(match[1]);
}

/**
 * Builds each segment's inline verse-superscript labels over the whole book in document order,
 * chapter-qualifying the label of every verse start that opens a new chapter.
 *
 * A verse start opens a new chapter when its chapter (read from the token at its offset) exceeds
 * the highest chapter seen so far; its label becomes `chapter:number`. Every other verse start
 * keeps its bare verbatim number.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to the parallel-by-index labels for that segment's `verseStarts`.
 */
export function buildVerseStartLabels(segments: readonly Segment[]): Map<string, string[]> {
  const labelsBySegmentId = new Map<string, string[]>();
  let maxChapterSeen = 0;
  segments.forEach((segment) => {
    const verseStartLabels = segment.verseStarts.map((vs) => {
      const startToken = segment.tokens.find((t) => t.charStart === vs.charStart);
      const chapter = startToken ? chapterOfTokenRef(startToken.ref) : undefined;
      if (chapter !== undefined && chapter > maxChapterSeen) {
        maxChapterSeen = chapter;
        return `${chapter}:${vs.number}`;
      }
      return vs.number;
    });
    labelsBySegmentId.set(segment.id, verseStartLabels);
  });
  return labelsBySegmentId;
}
