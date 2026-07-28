/**
 * Pure transforms over a {@link SegmentationDelta}, the user's custom segment boundaries expressed
 * as a delta from the default one-segment-per-verse segmentation.
 *
 * Every transform takes the _original_ verse-tokenized book — never the re-segmented one — because
 * that is what the default verse starts are derived from, and returns a normalized delta.
 */
import type { Book, SegmentationDelta } from 'interlinearizer';

/** An empty delta — equivalent to the default verse segmentation. */
const EMPTY_DELTA: SegmentationDelta = { removedVerseStarts: [], addedStarts: [] };

/**
 * The whole-book lookups every transform in this module needs, derived in a single pass over the
 * token stream so one boundary operation walks the book once.
 */
type BookLookups = Readonly<{
  /**
   * The default segment-start refs — each verse's first token (any type, so leading punctuation
   * stays with its verse).
   */
  defaults: ReadonlySet<string>;
  /** Every token ref in the book, used to drop delta anchors whose token no longer exists. */
  all: ReadonlySet<string>;
  /** Document-order index for every token ref, used to keep delta arrays canonically sorted. */
  order: ReadonlyMap<string, number>;
  /** The book's very first token ref — the start of the first segment, never merged leftward. */
  first: string | undefined;
}>;

/**
 * Per-book cache of {@link BookLookups}. A tokenized book's identity is stable until it is
 * re-tokenized, so every operation reuses one traversal.
 */
const bookLookupsCache = new WeakMap<Book, BookLookups>();

function bookLookups(verseBook: Book): BookLookups {
  const cached = bookLookupsCache.get(verseBook);
  if (cached) return cached;
  const defaults = new Set<string>();
  const all = new Set<string>();
  const order = new Map<string, number>();
  let i = 0;
  verseBook.segments.forEach((seg) => {
    const firstToken = seg.tokens[0];
    if (firstToken) defaults.add(firstToken.ref);
    seg.tokens.forEach((t) => {
      all.add(t.ref);
      order.set(t.ref, i);
      i += 1;
    });
  });
  const lookups: BookLookups = {
    defaults,
    all,
    order,
    first: verseBook.segments[0]?.tokens[0]?.ref,
  };
  bookLookupsCache.set(verseBook, lookups);
  return lookups;
}

/**
 * The default segment-start refs — each verse segment's first token, of any type, so a verse's
 * leading punctuation stays with that verse.
 */
export function defaultVerseStarts(verseBook: Book): ReadonlySet<string> {
  return bookLookups(verseBook).defaults;
}

/**
 * The token refs that begin a segment once the delta is applied to the default verse starts:
 * `(defaults \ removedVerseStarts) ∪ addedStarts`. Added anchors whose token no longer exists are
 * dropped, and the book's first token is always forced to be a start. Shared with re-segmentation
 * so it and the editing operations agree on where boundaries fall.
 */
export function effectiveStarts(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
): Set<string> {
  const { defaults, all, first } = bookLookups(verseBook);
  const removed = new Set(delta?.removedVerseStarts ?? []);
  const starts = new Set<string>();
  defaults.forEach((ref) => {
    if (!removed.has(ref)) starts.add(ref);
  });
  if (delta) {
    delta.addedStarts.forEach((ref) => {
      if (all.has(ref)) starts.add(ref);
    });
  }
  // The first segment can never be merged away, so its start is always present.
  if (first !== undefined) starts.add(first);
  return starts;
}

/**
 * Canonicalizes a delta so that equal segmentations serialize identically: each array is deduped,
 * stripped of no-op entries, and sorted by document order.
 */
function normalize(verseBook: Book, delta: SegmentationDelta): SegmentationDelta {
  const { defaults, all, order, first } = bookLookups(verseBook);
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
 * Makes a token begin a segment — that is, splits before it. A default verse start that had been
 * merged away is un-merged; any other token is recorded as an added start. Already being a segment
 * start is a no-op.
 */
export function addBoundaryBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  const { defaults } = bookLookups(verseBook);
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
 * Stops a token from beginning a segment, merging it into the preceding one. A default verse start
 * is recorded as removed; a previously added split is dropped. Merging the book's first token is a
 * no-op, since the first segment cannot merge leftward.
 */
export function removeBoundaryAt(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  const { defaults, first } = bookLookups(verseBook);
  if (ref === first) return normalize(verseBook, current);
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
 * Moves a boundary from one token to another in a single step — the primitive behind pulling one
 * edge token across a segment boundary.
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
 * Merges a segment into the one before it. A thin alias for {@link removeBoundaryAt}, named for the
 * explicit merge control.
 *
 * @param secondSegmentStartRef - First-token ref of the segment being merged into its predecessor.
 */
export function mergeSegments(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  secondSegmentStartRef: string,
): SegmentationDelta {
  return removeBoundaryAt(verseBook, delta, secondSegmentStartRef);
}

/**
 * Splits a segment so a new one begins at the given token. A thin alias for
 * {@link addBoundaryBefore}, named for the explicit split control.
 */
export function splitSegmentBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  return addBoundaryBefore(verseBook, delta, ref);
}

/** Whether the delta represents the default verse segmentation: absent, or both arrays empty. */
export function isDefaultSegmentation(delta: SegmentationDelta | undefined): boolean {
  return !delta || (delta.removedVerseStarts.length === 0 && delta.addedStarts.length === 0);
}
