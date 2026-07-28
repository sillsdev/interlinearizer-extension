import type { Segment, VerseStart } from 'interlinearizer';

/**
 * Display label of one segment: the verse it begins at, extended with an en-dash range end when the
 * segment covers more than one verse.
 */
export type SegmentLabel = string;

/**
 * Builds the verse-range gutter label of every segment in book order, keyed by segment id. The
 * labels appear in the segment-view gutter column, never in the running text.
 *
 * After boundary edits a segment need not map 1:1 to a verse, so a label names the verse range it
 * covers rather than a single verse. Split portions are deliberately not lettered — two portions of
 * verse 1 both reading `1` reflects the overlap honestly.
 *
 * Labels derive from each segment's covered verse starts rather than its start/end refs, so a
 * cross-chapter or gapped merge names only the verses it actually covers instead of over-claiming
 * every verse between its endpoints.
 */
export function buildSegmentLabels(segments: readonly Segment[]): Map<string, SegmentLabel> {
  return new Map(segments.map((seg) => [seg.id, labelForSegment(seg.verseStarts)]));
}

/** Formats one segment's label as `first`, `first–last`, or `first–chapter:last`. */
function labelForSegment(verseStarts: readonly VerseStart[]): SegmentLabel {
  const first = verseStarts[0];
  const last = verseStarts[verseStarts.length - 1];
  if (first === last) return first.number;
  // Qualify the end with its chapter when the segment crosses a chapter boundary, so the range is
  // unambiguous (`29–2:1`, not `29–1`).
  const endText = last.chapter === first.chapter ? last.number : `${last.chapter}:${last.number}`;
  return `${first.number}–${endText}`;
}
