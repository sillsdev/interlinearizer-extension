/**
 * @file Pure helpers deriving the display label of each segment in a (re)segmented book.
 *
 *   After boundary edits (merge/split) a segment no longer corresponds 1:1 to a verse, so its label
 *   cannot simply be the start verse number. Instead each segment gets a per-chapter sequential
 *   segment number — starting at 1, or at 0 when the chapter opens with a verse-0 superscription
 *   segment — plus the range of verses it contains, shown beside the number.
 *
 *   Every function here is pure and store-free (mirrors `segmentation.ts`).
 */
import type { ScriptureRef, Segment } from 'interlinearizer';

/** Display label parts for one segment. */
export type SegmentLabel = Readonly<{
  /**
   * Per-chapter sequential segment number. The first segment starting in a chapter gets 1 — or 0
   * when it is a verse-0 superscription segment — and each following segment of the same chapter
   * counts up by one, regardless of which verses it contains.
   */
  ordinal: number;
  /**
   * The range of verses the segment contains, e.g. `"5"` (single verse), `"5–7"` (merged run), or
   * `"29–2:1"` when the segment crosses a chapter boundary (the end carries its chapter for
   * disambiguation).
   */
  verseRange: string;
}>;

/**
 * Formats the verse range covered by a segment. A single verse renders as its bare number, a
 * same-chapter run as `start–end`, and a chapter-crossing run qualifies the end with its chapter
 * (`start–chapter:verse`) since a bare end verse would be ambiguous.
 *
 * @param startRef - The segment's start coordinate.
 * @param endRef - The segment's end coordinate.
 * @returns The formatted verse range.
 */
function formatVerseRange(startRef: ScriptureRef, endRef: ScriptureRef): string {
  if (startRef.chapter !== endRef.chapter) {
    return `${startRef.verse}–${endRef.chapter}:${endRef.verse}`;
  }
  if (startRef.verse !== endRef.verse) return `${startRef.verse}–${endRef.verse}`;
  return `${startRef.verse}`;
}

/**
 * Builds the display label of every segment in book order, keyed by segment id. A segment belongs
 * to the chapter its `startRef` names; numbering restarts there whenever that chapter changes from
 * the previous segment's, beginning at 0 when the chapter's first segment starts at verse 0 (a
 * superscription) and at 1 otherwise.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to its {@link SegmentLabel}.
 */
export function buildSegmentLabels(segments: readonly Segment[]): Map<string, SegmentLabel> {
  const labels = new Map<string, SegmentLabel>();
  let chapter: number | undefined;
  let ordinal = 0;
  segments.forEach((seg) => {
    if (seg.startRef.chapter !== chapter) {
      chapter = seg.startRef.chapter;
      ordinal = seg.startRef.verse === 0 ? 0 : 1;
    } else {
      ordinal += 1;
    }
    labels.set(seg.id, { ordinal, verseRange: formatVerseRange(seg.startRef, seg.endRef) });
  });
  return labels;
}
