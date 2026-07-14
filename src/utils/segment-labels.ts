/**
 * @file Pure helper deriving each segment's verse-range gutter label in a (re)segmented book.
 *
 *   After boundary edits (merge/split) a segment no longer corresponds 1:1 to a verse, so its label
 *   cannot simply be the start verse number. The gutter names the verse range a segment overlaps:
 *   an unsplit verse's segment (and every portion of a split verse) is labeled with its bare verse
 *   number, and a segment spanning several verses shows the range between its two covered ends
 *   (`2–3`, `29–2:1`). Split-verse portions are deliberately not lettered: the gutter is an
 *   alternative to the inline verse superscripts, and two adjacent portions of verse 1 both reading
 *   `1` reflects the overlap honestly without inventing per-portion identity. These labels are
 *   shown in the segment-view gutter column, never in the running text.
 *
 *   The label is derived from the segment's `verseStarts` — the exact set of source verses it covers
 *   — not the `startRef`/`endRef` interval, so a cross-chapter or gapped merge names only the
 *   verses it actually covers instead of over-claiming every verse between its endpoints.
 */
import type { Segment, VerseStart } from 'interlinearizer';

/**
 * Display label of one segment: the verse it begins at, extended with an en-dash range end when the
 * segment covers more than one verse.
 */
export type SegmentLabel = string;

/**
 * Builds the verse-range gutter label of every segment in book order, keyed by segment id. The
 * label is the segment's first covered verse, extended to `start–end` when the segment covers more
 * than one verse, with the end qualified by its chapter (`start–chapter:end`) when the segment
 * crosses a chapter boundary.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to its {@link SegmentLabel}.
 */
export function buildSegmentLabels(segments: readonly Segment[]): Map<string, SegmentLabel> {
  return new Map(segments.map((seg) => [seg.id, labelForSegment(seg.verseStarts)]));
}

/**
 * Formats one segment's verse-range label from its covered verse starts: the first verse's bare
 * number, extended to `first–last` when the segment covers more than one verse, with the last
 * qualified by its chapter (`first–chapter:last`) across a chapter boundary.
 *
 * @param verseStarts - The segment's covered verse starts, in document order.
 * @returns The verse-range label.
 */
function labelForSegment(verseStarts: readonly VerseStart[]): SegmentLabel {
  const first = verseStarts[0];
  const last = verseStarts[verseStarts.length - 1];
  if (first === last) return first.number;
  // Qualify the end with its chapter when the segment crosses a chapter boundary, so the range is
  // unambiguous (`29–2:1`, not `29–1`).
  const endText = last.chapter === first.chapter ? last.number : `${last.chapter}:${last.number}`;
  return `${first.number}–${endText}`;
}
