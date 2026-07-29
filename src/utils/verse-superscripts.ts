import type { Segment, Token, VerseStart } from 'interlinearizer';
import type { LinkSlot } from '../types/token-layout';

/**
 * Finds the token that renders a verse start. Deliberately not an exact offset match: a verse whose
 * baseline begins with whitespace has its first token a few characters in. An empty verse has no
 * token to carry the superscript and yields `undefined`.
 *
 * @returns The first token at or after the verse start's offset, or `undefined` when none exists.
 */
export function verseStartToken(segment: Segment, vs: VerseStart): Token | undefined {
  return segment.tokens.find((t) => t.charStart >= vs.charStart);
}

/**
 * Builds each segment's inline verse-superscript labels over the whole book in document order,
 * keyed by segment id and parallel by index to that segment's verse starts. A verse start opening a
 * new chapter is qualified as `chapter:number`; every other keeps its bare verbatim number.
 *
 * Chapter is read from the verse start itself rather than from a token, so qualification stays
 * correct regardless of where segment boundaries fall — including for an empty verse or one whose
 * baseline opens with whitespace. The pinned chapter header is a separate scroll-driven overlay,
 * not derived here.
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
 * Resolves the inline verse label for a between-group slot — the verse that begins as the slot is
 * crossed — or `undefined` when no verse begins there. Shared by both strips so they mark verse
 * boundaries on the same slot.
 *
 * Every token of the following group is a candidate, not just the first: a phrase spanning an
 * internal verse boundary of a merged segment fuses its tokens into one group, so the verse-start
 * word can sit mid-group. A group fusing across _two_ internal verse boundaries shows only the
 * first verse's number, since a slot carries one label; a second buried verse start would need an
 * in-box superscript this model lacks.
 *
 * @returns The verse label to render at this slot, or `undefined` when no verse begins here.
 */
export function slotVerseLabel(
  slot: LinkSlot,
  verseStartLabelByTokenRef: ReadonlyMap<string, string>,
): string | undefined {
  // Priority: next group's first token, then gap punctuation, then the remaining group tokens — so a
  // verse start buried mid-group is caught only after the leading token and punctuation are checked.
  const nextGroupRefs = slot.nextGroup?.tokens.map((t) => t.ref) ?? [];
  const candidateRefs = [
    nextGroupRefs[0],
    ...slot.punctuation.map((p) => p.ref),
    ...nextGroupRefs.slice(1),
  ];
  const verseStartRef = candidateRefs.find(
    (tokenRef) => tokenRef !== undefined && verseStartLabelByTokenRef.has(tokenRef),
  );
  return verseStartRef === undefined ? undefined : verseStartLabelByTokenRef.get(verseStartRef);
}

/**
 * Builds a whole-book lookup from each verse-start token's ref to its inline superscript label.
 * Computed once and shared by both strips, so the continuous view and the segment list mark verse
 * boundaries identically and neither re-walks the book to key labels by token ref.
 *
 * Empty verses contribute no entry, having no token to carry the number, but are still walked so
 * chapter qualification stays correct across them.
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
