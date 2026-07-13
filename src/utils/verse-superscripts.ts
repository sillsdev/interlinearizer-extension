/**
 * @file Pure helper deriving inline verse-superscript labels for a (re)segmented book.
 *
 *   Verse numbers render as inline superscripts sourced verbatim from the USJ verse marker (carried
 *   on `Segment.verseStarts`). This module decides, over the whole book in document order, which
 *   verse starts open a new chapter — those get a `chapter:number` qualifier; all others render
 *   their bare verbatim number. (The pinned "Book N" chapter header is a separate scroll-driven
 *   overlay in the list, not derived here.)
 *
 *   The chapter of a verse start is read from `VerseStart.chapter`, so a chapter boundary absorbed
 *   into a merged segment is still qualified — the qualifier triggers off "verse start whose
 *   chapter exceeds every chapter seen so far", regardless of where the segment boundary falls, and
 *   is correct even for an empty verse (no token to inspect) or a verse whose baseline begins with
 *   whitespace (first token not at the verse-start offset).
 */
import type { Segment, Token, VerseStart } from 'interlinearizer';
import type { LinkSlot } from '../types/token-layout';

/**
 * Finds the token that renders a verse start — the first token whose `charStart` is at or after the
 * verse start's offset. An exact `charStart === vs.charStart` match is not required: a verse whose
 * baseline begins with whitespace has its first token a few characters in, so the strict match
 * would miss it and drop the inline number. Returns `undefined` for an empty verse, which has no
 * token to carry the superscript.
 *
 * @param segment - The segment the verse start belongs to.
 * @param vs - The verse start whose leading token is wanted.
 * @returns The first token at or after the verse start's offset, or `undefined` when none exists.
 */
export function verseStartToken(segment: Segment, vs: VerseStart): Token | undefined {
  return segment.tokens.find((t) => t.charStart >= vs.charStart);
}

/**
 * Builds each segment's inline verse-superscript labels over the whole book in document order,
 * chapter-qualifying the label of every verse start that opens a new chapter.
 *
 * A verse start opens a new chapter when its `chapter` exceeds the highest chapter seen so far; its
 * label becomes `chapter:number`. Every other verse start keeps its bare verbatim number.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from segment id to the parallel-by-index labels for that segment's `verseStarts`.
 */
export function buildVerseStartLabels(segments: readonly Segment[]): Map<string, string[]> {
  const labelsBySegmentId = new Map<string, string[]>();
  let maxChapterSeen = 0;
  segments.forEach((segment) => {
    const verseStartLabels = segment.verseStarts.map((vs) => {
      if (vs.chapter > maxChapterSeen) {
        maxChapterSeen = vs.chapter;
        return `${vs.chapter}:${vs.number}`;
      }
      return vs.number;
    });
    labelsBySegmentId.set(segment.id, verseStartLabels);
  });
  return labelsBySegmentId;
}

/**
 * Resolves the inline verse label for a between-group slot: the label of the verse that begins as
 * the slot is crossed. A verse begins at a slot when its start token renders next through it — the
 * following group's first token, or (for a verse opening on leading punctuation) one of the slot's
 * own gap-punctuation tokens. Shared by both strips so they mark verse boundaries on the same
 * slot.
 *
 * @param slot - The between-group slot to test.
 * @param verseStartLabelByTokenRef - Verse-start token ref → label, from
 *   {@link buildVerseStartLabelsByTokenRef}.
 * @returns The verse label to render at this slot, or `undefined` when no verse begins here.
 */
export function slotVerseLabel(
  slot: LinkSlot,
  verseStartLabelByTokenRef: ReadonlyMap<string, string>,
): string | undefined {
  const candidateRefs = [slot.nextGroup?.tokens[0]?.ref, ...slot.punctuation.map((p) => p.ref)];
  const verseStartRef = candidateRefs.find(
    (tokenRef) => tokenRef !== undefined && verseStartLabelByTokenRef.has(tokenRef),
  );
  return verseStartRef === undefined ? undefined : verseStartLabelByTokenRef.get(verseStartRef);
}

/**
 * Builds a whole-book lookup from the ref of each verse-start token to its inline superscript label
 * (chapter-qualified where a verse start opens a new chapter). Computed once over `book.segments`
 * and shared by both strips so the continuous view and the segment list mark verse boundaries
 * identically and neither re-walks the book to key labels by token ref.
 *
 * Empty verses contribute no entry (they have no token to carry the number); the label array is
 * still walked so chapter qualification stays correct across them.
 *
 * @param segments - The book's segments in document order.
 * @returns Map from a verse-start token's ref to its resolved label.
 */
export function buildVerseStartLabelsByTokenRef(segments: readonly Segment[]): Map<string, string> {
  const labelsBySegmentId = buildVerseStartLabels(segments);
  const labelByTokenRef = new Map<string, string>();
  segments.forEach((segment) => {
    /* v8 ignore next -- buildVerseStartLabels keys off these same segments, so the entry always exists */
    const labels = labelsBySegmentId.get(segment.id) ?? [];
    segment.verseStarts.forEach((vs, i) => {
      // A continuation entry (a mid-verse split's later piece) contributes no label: the verse's
      // number already showed at its real start in a previous segment.
      if (vs.isContinuation) return;
      const startToken = verseStartToken(segment, vs);
      if (startToken && labels[i] !== undefined) labelByTokenRef.set(startToken.ref, labels[i]);
    });
  });
  return labelByTokenRef;
}
