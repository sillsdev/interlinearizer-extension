/**
 * @file Pure helpers deriving the display label of each segment in a (re)segmented book.
 *
 *   After boundary edits (merge/split) a segment no longer corresponds 1:1 to a verse, so its label
 *   cannot simply be the start verse number. Labels stay verse-based: an unsplit verse's segment is
 *   labeled with its bare verse number, each portion of a split verse is lettered (`1a`, `1b`, …),
 *   and a segment spanning several verses shows the range between its two ends (`1c–2`, `29–2:1`).
 *
 *   Every function here is pure and store-free (mirrors `segmentation.ts`).
 */
import type { ScriptureRef, Segment } from 'interlinearizer';

/**
 * Display label of one segment: the verse (or lettered verse portion) it starts at, extended with
 * an en-dash range end when the segment spans more than one verse. Examples: `"5"` (whole verse),
 * `"5a"` / `"5b"` (portions of a split verse), `"5b–7"` (a split portion merged with following
 * verses), and `"29–2:1"` (a chapter-crossing segment; the end carries its chapter for
 * disambiguation).
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
 * Keys a reference by chapter and verse so portions of the same verse collate together. The book is
 * omitted: all segments of one call belong to the same book.
 *
 * @param ref - The reference to key.
 * @returns The `chapter:verse` key.
 */
function verseKey(ref: ScriptureRef): string {
  return `${ref.chapter}:${ref.verse}`;
}

/**
 * Builds the display label of every segment in book order, keyed by segment id.
 *
 * A verse wholly inside one segment contributes a bare verse number; a verse divided across
 * segments (by a split, or by a boundary sitting mid-verse) gets its portions lettered `a`, `b`, …
 * in document order. Each segment's label is its start verse (with letter when that verse is
 * divided), extended to `start–end` when the segment ends in a different verse, with the end
 * qualified by its chapter (`start–chapter:verse`) when the segment crosses a chapter boundary.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to its {@link SegmentLabel}.
 */
export function buildSegmentLabels(segments: readonly Segment[]): Map<string, SegmentLabel> {
  // First pass: assign each segment its zero-based portion index within its start and end verses,
  // and tally how many portions each verse is divided into. Segments are contiguous and in document
  // order, so a verse's portions are consumed consecutively; once a segment ends past a verse, no
  // later segment touches it.
  const portionCounts = new Map<string, number>();
  const portionIndices = segments.map((seg) => {
    const startKey = verseKey(seg.startRef);
    const endKey = verseKey(seg.endRef);
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
  const labels = new Map<string, SegmentLabel>();
  segments.forEach((seg, i) => {
    const { startPortion, endPortion } = portionIndices[i];
    /* v8 ignore next -- every start key was inserted in the first pass, so the ?? arm is unreachable */
    const isStartSplit = (portionCounts.get(verseKey(seg.startRef)) ?? 0) > 1;
    const startText = `${seg.startRef.verse}${isStartSplit ? portionLetter(startPortion) : ''}`;
    if (seg.startRef.chapter === seg.endRef.chapter && seg.startRef.verse === seg.endRef.verse) {
      labels.set(seg.id, startText);
      return;
    }
    /* v8 ignore next -- every end key was inserted in the first pass, so the ?? arm is unreachable */
    const isEndSplit = (portionCounts.get(verseKey(seg.endRef)) ?? 0) > 1;
    const endText = `${seg.endRef.verse}${isEndSplit ? portionLetter(endPortion) : ''}`;
    labels.set(
      seg.id,
      seg.startRef.chapter === seg.endRef.chapter
        ? `${startText}–${endText}`
        : `${startText}–${seg.endRef.chapter}:${endText}`,
    );
  });
  return labels;
}
