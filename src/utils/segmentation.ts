/**
 * @file Pure transforms over a {@link SegmentationDelta} — the user's custom segment boundaries
 *   expressed as a delta from the default one-segment-per-verse segmentation.
 *
 *   A segment is a maximal contiguous run of the book's document-order token stream between "start"
 *   tokens. The default start tokens are each verse's first token; the delta records where the
 *   user's boundaries differ (a removed verse start merges that verse into the previous segment; an
 *   added start splits a verse). Because a segment can only be a contiguous run between starts,
 *   discontiguous segments are unrepresentable.
 *
 *   Every function here is pure and store-free (mirrors `phrase-arc.ts`). They take the original
 *   verse-tokenized {@link Book} (from `tokenizeBook`, before re-segmentation) so they can derive
 *   the default verse starts; they never need the re-segmented book.
 */
import type { Book, SegmentationDelta } from 'interlinearizer';

/** An empty delta — equivalent to the default verse segmentation. */
const EMPTY_DELTA: SegmentationDelta = { removedVerseStarts: [], addedStarts: [] };

/**
 * The ref of the book's very first token — the start of the first segment, which can never be
 * merged leftward.
 *
 * @param verseBook - The original verse-tokenized book.
 * @returns The first token's ref, or `undefined` when the book has no tokens.
 */
function bookFirstTokenRef(verseBook: Book): string | undefined {
  return verseBook.segments[0]?.tokens[0]?.ref;
}

/**
 * The default segment-start refs — each verse segment's first token (of any type, so a verse's
 * leading punctuation stays with that verse).
 *
 * @param verseBook - The original verse-tokenized book.
 * @returns The set of first-token refs, one per verse segment that has tokens.
 */
export function defaultVerseStarts(verseBook: Book): Set<string> {
  const starts = new Set<string>();
  verseBook.segments.forEach((seg) => {
    const first = seg.tokens[0];
    if (first) starts.add(first.ref);
  });
  return starts;
}

/**
 * Every token ref in the book, used to drop delta anchors whose token no longer exists.
 *
 * @param verseBook - The original verse-tokenized book.
 * @returns The set of all token refs.
 */
function allTokenRefs(verseBook: Book): Set<string> {
  const refs = new Set<string>();
  verseBook.segments.forEach((seg) => seg.tokens.forEach((t) => refs.add(t.ref)));
  return refs;
}

/**
 * The interior token refs of every verse-0 segment — each verse-0 segment's tokens except its
 * first. A verse-0 segment is a chapter superscription (e.g. a Psalm title); its tokens must always
 * stay together in one segment, so no boundary may ever fall strictly inside it. Verse 0 may still
 * be merged wholesale into a neighbor (it travels as an intact unit) — only splitting it is
 * forbidden.
 *
 * @param verseBook - The original verse-tokenized book.
 * @returns The set of token refs interior to a verse-0 segment.
 */
function verseZeroInteriorRefs(verseBook: Book): Set<string> {
  const interior = new Set<string>();
  verseBook.segments.forEach((seg) => {
    if (seg.startRef.verse !== 0) return;
    seg.tokens.slice(1).forEach((t) => interior.add(t.ref));
  });
  return interior;
}

/**
 * Document-order index for every token ref, used to keep delta arrays canonically sorted.
 *
 * @param verseBook - The original verse-tokenized book.
 * @returns Map from token ref to its flat document index.
 */
function docOrder(verseBook: Book): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  verseBook.segments.forEach((seg) =>
    seg.tokens.forEach((t) => {
      order.set(t.ref, i);
      i += 1;
    }),
  );
  return order;
}

/**
 * The effective set of segment-start refs after applying `delta` to the default verse starts:
 * `(defaults \ removedVerseStarts) ∪ addedStarts`, with added anchors dropped when their token no
 * longer exists and the book's first token always forced to be a start. Shared with `resegmentBook`
 * so re-segmentation and the editing operations agree on where boundaries fall.
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The user's boundary delta, or `undefined` for the default segmentation.
 * @returns The set of token refs that begin a segment.
 */
export function effectiveStarts(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
): Set<string> {
  const defaults = defaultVerseStarts(verseBook);
  const removed = new Set(delta?.removedVerseStarts ?? []);
  const starts = new Set<string>();
  defaults.forEach((ref) => {
    if (!removed.has(ref)) starts.add(ref);
  });
  if (delta) {
    const all = allTokenRefs(verseBook);
    delta.addedStarts.forEach((ref) => {
      if (all.has(ref)) starts.add(ref);
    });
  }
  const first = bookFirstTokenRef(verseBook);
  // The first segment can never be merged away, so its start is always present.
  if (first !== undefined) starts.add(first);
  return starts;
}

/**
 * Returns a canonicalized copy of `delta`: each array deduped, stripped of no-op entries (a removed
 * ref that is not a default start, or an added ref that is already a default start or whose token
 * is gone), and sorted by document order so equal segmentations serialize identically.
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The delta to canonicalize.
 * @returns A normalized {@link SegmentationDelta}.
 */
function normalize(verseBook: Book, delta: SegmentationDelta): SegmentationDelta {
  const defaults = defaultVerseStarts(verseBook);
  const all = allTokenRefs(verseBook);
  const order = docOrder(verseBook);
  const first = bookFirstTokenRef(verseBook);
  const byOrder = (a: string, b: string) =>
    /* v8 ignore next -- ?? 0 fallback for refs absent from order; filtered arrays only hold real refs */
    (order.get(a) ?? 0) - (order.get(b) ?? 0);

  const removedVerseStarts = [...new Set(delta.removedVerseStarts)]
    .filter((ref) => defaults.has(ref) && ref !== first)
    .sort(byOrder);
  const addedStarts = [...new Set(delta.addedStarts)]
    .filter((ref) => all.has(ref) && !defaults.has(ref))
    .sort(byOrder);

  return { removedVerseStarts, addedStarts };
}

/**
 * Makes `ref` begin a segment — i.e. splits before it.
 *
 * - When `ref` is a default verse start that was merged away, it is un-merged (dropped from
 *   `removedVerseStarts`).
 * - Otherwise `ref` is recorded as an added start.
 *
 * No-op (returns an equivalent normalized delta) when `ref` already begins a segment, or when `ref`
 * is an interior token of a verse-0 segment (splitting it would push tokens out of the
 * superscription).
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The current delta, or `undefined` for the default segmentation.
 * @param ref - The token ref that should begin a segment.
 * @returns The updated, normalized delta.
 */
export function addBoundaryBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  if (verseZeroInteriorRefs(verseBook).has(ref)) return normalize(verseBook, current);
  const defaults = defaultVerseStarts(verseBook);
  if (defaults.has(ref)) {
    return normalize(verseBook, {
      removedVerseStarts: current.removedVerseStarts.filter((r) => r !== ref),
      addedStarts: current.addedStarts,
    });
  }
  return normalize(verseBook, {
    removedVerseStarts: current.removedVerseStarts,
    addedStarts: [...current.addedStarts, ref],
  });
}

/**
 * Stops `ref` from beginning a segment — i.e. merges it into the preceding segment.
 *
 * - When `ref` is a default verse start, it is recorded in `removedVerseStarts`.
 * - Otherwise (it was an added split) it is dropped from `addedStarts`.
 *
 * No-op when `ref` is the book's first token (the first segment cannot be merged leftward). A
 * verse-0 boundary may be removed: that merges the superscription wholesale into a neighbor, which
 * keeps its tokens together (a split, not a merge, is what is forbidden — see
 * {@link addBoundaryBefore}).
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The current delta, or `undefined` for the default segmentation.
 * @param ref - The segment-start token ref to remove.
 * @returns The updated, normalized delta.
 */
export function removeBoundaryAt(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  if (ref === bookFirstTokenRef(verseBook)) return normalize(verseBook, current);
  const defaults = defaultVerseStarts(verseBook);
  if (defaults.has(ref)) {
    return normalize(verseBook, {
      removedVerseStarts: [...current.removedVerseStarts, ref],
      addedStarts: current.addedStarts,
    });
  }
  return normalize(verseBook, {
    removedVerseStarts: current.removedVerseStarts,
    addedStarts: current.addedStarts.filter((r) => r !== ref),
  });
}

/**
 * Moves a boundary from `fromRef` to `toRef` in one step — the primitive behind pulling a single
 * edge token across a segment boundary. Removes the start at `fromRef` and adds one at `toRef`. If
 * `toRef` falls inside a verse-0 segment the add half is a no-op (verse 0 can't be split), so the
 * move degrades to a plain removal.
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The current delta, or `undefined` for the default segmentation.
 * @param fromRef - The current segment-start ref to remove.
 * @param toRef - The new segment-start ref to add.
 * @returns The updated, normalized delta.
 */
export function moveBoundary(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  fromRef: string,
  toRef: string,
): SegmentationDelta {
  return addBoundaryBefore(verseBook, removeBoundaryAt(verseBook, delta, fromRef), toRef);
}

/**
 * Merges the segment that starts at `secondSegmentStartRef` into the segment before it. Thin alias
 * for {@link removeBoundaryAt}, named for the explicit merge control.
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The current delta, or `undefined` for the default segmentation.
 * @param secondSegmentStartRef - The first-token ref of the segment being merged into its
 *   predecessor.
 * @returns The updated, normalized delta.
 */
export function mergeSegments(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  secondSegmentStartRef: string,
): SegmentationDelta {
  return removeBoundaryAt(verseBook, delta, secondSegmentStartRef);
}

/**
 * Splits a segment so a new one begins at `ref`. Thin alias for {@link addBoundaryBefore}, named for
 * the explicit split control.
 *
 * @param verseBook - The original verse-tokenized book.
 * @param delta - The current delta, or `undefined` for the default segmentation.
 * @param ref - The token ref the new segment should begin at.
 * @returns The updated, normalized delta.
 */
export function splitSegmentBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  return addBoundaryBefore(verseBook, delta, ref);
}

/**
 * Whether `delta` represents the default verse segmentation (absent or both arrays empty).
 *
 * @param delta - The delta to test.
 * @returns `true` when applying `delta` yields the default segmentation.
 */
export function isDefaultSegmentation(delta: SegmentationDelta | undefined): boolean {
  return !delta || (delta.removedVerseStarts.length === 0 && delta.addedStarts.length === 0);
}
