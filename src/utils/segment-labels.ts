/**
 * @file Pure helper deriving each segment's verse/range gutter label in a (re)segmented book.
 *
 *   After boundary edits (merge/split) a segment no longer corresponds 1:1 to a verse, so its label
 *   cannot simply be the start verse number. Labels stay verse-based: an unsplit verse's segment is
 *   labeled with its bare verse number, each portion of a split verse is lettered (`1a`, `1b`, …),
 *   and a segment spanning several verses shows the range between its two covered ends (`1c–2`,
 *   `29–2:1`). These labels are shown in the segment-view gutter column (alongside the inline
 *   verbatim verse superscripts), never in the running text.
 *
 *   The label is derived from the segment's `verseStarts` — the exact set of source verses it covers
 *   — not the `startRef`/`endRef` interval, so a cross-chapter or gapped merge names only the
 *   verses it actually covers instead of over-claiming every verse between its endpoints.
 */
import type { Segment, VerseStart } from 'interlinearizer';

/**
 * Display label of one segment: the verse (or lettered verse portion) it begins at, extended with
 * an en-dash range end when the segment covers more than one verse.
 */
export type SegmentLabel = string;

/**
 * Formats a zero-based portion index as a lowercase letter suffix — `a` through `z`, continuing
 * bijectively (`aa`, `ab`, …) should a verse ever be split into more than 26 portions.
 *
 * @param index - Zero-based index of the portion within its verse.
 * @returns The letter suffix for the portion.
 */
function portionLetter(index: number): string {
  let remaining = index;
  let letters = '';
  do {
    letters = String.fromCharCode(97 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return letters;
}

/**
 * Keys a verse start by chapter and number so portions of the same verse collate together. The book
 * is omitted: all segments of one call belong to the same book.
 *
 * @param vs - The verse start to key.
 * @returns The `chapter:number` key.
 */
function verseKey(vs: VerseStart): string {
  return `${vs.chapter}:${vs.number}`;
}

/**
 * Builds the display label of every segment in book order, keyed by segment id. The label is
 * derived from each segment's `verseStarts` covered-verse set: the first covered verse (with a
 * portion letter when that verse is split across segments), extended to `start–end` when the
 * segment covers more than one verse, with the end qualified by its chapter (`start–chapter:end`)
 * when the segment crosses a chapter boundary.
 *
 * A verse wholly inside one segment contributes a bare verse number; a verse divided across
 * segments (a mid-verse split) gets its portions lettered `a`, `b`, … in document order. Segments
 * are contiguous and in document order, so a verse's portions are consumed consecutively.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to its {@link SegmentLabel}.
 */
export function buildSegmentLabels(segments: readonly Segment[]): Map<string, SegmentLabel> {
  // First pass: assign each segment its zero-based portion index within its first and last covered
  // verse, and tally how many portions each verse is divided into.
  const portionCounts = new Map<string, number>();
  const portionIndices = segments.map((seg) => {
    const first = seg.verseStarts[0];
    const last = seg.verseStarts[seg.verseStarts.length - 1];
    const startKey = verseKey(first);
    const endKey = verseKey(last);
    const startPortion = portionCounts.get(startKey) ?? 0;
    portionCounts.set(startKey, startPortion + 1);
    let endPortion = startPortion;
    if (endKey !== startKey) {
      endPortion = portionCounts.get(endKey) ?? 0;
      portionCounts.set(endKey, endPortion + 1);
    }
    return { startPortion, endPortion };
  });

  // Second pass: format each label, lettering only the ends whose verse is actually divided
  // (portion count > 1) so unsplit verses keep their bare numbers.
  return new Map(
    segments.map((seg, i) => {
      const first = seg.verseStarts[0];
      const last = seg.verseStarts[seg.verseStarts.length - 1];
      const { startPortion, endPortion } = portionIndices[i];
      /* v8 ignore next -- every start key was inserted in the first pass, so the ?? arm is unreachable */
      const startSplit = (portionCounts.get(verseKey(first)) ?? 0) > 1;
      const startText = `${first.number}${startSplit ? portionLetter(startPortion) : ''}`;
      if (first === last) return [seg.id, startText];
      /* v8 ignore next -- every end key was inserted in the first pass, so the ?? arm is unreachable */
      const endSplit = (portionCounts.get(verseKey(last)) ?? 0) > 1;
      const endNumber = `${last.number}${endSplit ? portionLetter(endPortion) : ''}`;
      // Qualify the end with its chapter when the segment crosses a chapter boundary, so the range
      // is unambiguous (`29–2:1`, not `29–1`).
      const endText = last.chapter === first.chapter ? endNumber : `${last.chapter}:${endNumber}`;
      return [seg.id, `${startText}–${endText}`];
    }),
  );
}
