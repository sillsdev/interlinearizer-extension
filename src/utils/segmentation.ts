/**
 * Pure transforms over a {@link SegmentationDelta}, the user's custom segment boundaries expressed
 * as a delta from the default one-segment-per-verse segmentation.
 *
 * Every transform takes the _original_ verse-tokenized book — never the re-segmented one — because
 * that is what the default verse starts are derived from, and returns a normalized delta.
 */
import type { Book, SegmentationDelta } from 'interlinearizer';
import { bookOfRef } from './analysis-book';

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
  /**
   * The default starts a removal can actually merge leftward — those whose verse directly follows a
   * token-bearing one. A verse opening the book or following a token-less verse marker has no
   * preceding run to be absorbed into.
   */
  mergeable: ReadonlySet<string>;
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
  const mergeable = new Set<string>();
  let i = 0;
  let precededByTokens = false;
  verseBook.segments.forEach((seg) => {
    const firstToken = seg.tokens[0];
    if (firstToken) {
      defaults.add(firstToken.ref);
      if (precededByTokens) mergeable.add(firstToken.ref);
    }
    seg.tokens.forEach((t) => {
      all.add(t.ref);
      order.set(t.ref, i);
      i += 1;
    });
    precededByTokens = seg.tokens.length > 0;
  });
  const lookups: BookLookups = { defaults, all, order, mergeable };
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
 * dropped, and only a removal with a preceding run to merge into takes effect. This is the single
 * definition of where a segment begins, so no two boundary operations can disagree.
 */
export function effectiveStarts(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
): Set<string> {
  const { defaults, all, mergeable } = bookLookups(verseBook);
  const removed = new Set(delta?.removedVerseStarts ?? []);
  const starts = new Set<string>();
  defaults.forEach((ref) => {
    // A start with nothing to merge leftward into survives its own removal.
    if (!removed.has(ref) || !mergeable.has(ref)) starts.add(ref);
  });
  if (delta) {
    delta.addedStarts.forEach((ref) => {
      if (all.has(ref)) starts.add(ref);
    });
  }
  return starts;
}

/**
 * A predicate per kind of delta entry, each answering whether this book's loaded source still lets
 * that entry change where a segment begins — the single definition of that question.
 *
 * Drift unhonors an entry either by dropping its token or by moving the token into a role the entry
 * no longer fits, which includes leaving a removal with no preceding run to merge into.
 */
function honorsAnchor({ defaults, all, mergeable }: BookLookups) {
  return {
    removal: (ref: string) => all.has(ref) && defaults.has(ref) && mergeable.has(ref),
    addition: (ref: string) => all.has(ref) && !defaults.has(ref),
  };
}

/**
 * Canonicalizes a delta so that equal segmentations serialize identically: each array is deduped,
 * stripped of no-op entries, and sorted.
 *
 * One delta spans every book of its draft, so anchors naming a book other than `verseBook` are
 * carried through untouched — dropping them would delete boundaries the user set in a book they
 * merely navigated away from. They sort after this book's.
 *
 * Anchors that this book's loaded source does not honor survive for the same reason — a drifted
 * source may yet revert, and no edit elsewhere in the book should be what makes that loss
 * permanent.
 *
 * Only this book's honored anchors have a document order to sort by; the two tails sort by ref.
 */
function normalize(verseBook: Book, delta: SegmentationDelta): SegmentationDelta {
  const lookups = bookLookups(verseBook);
  const { order } = lookups;
  const honors = honorsAnchor(lookups);
  const byOrder = (a: string, b: string) =>
    /* v8 ignore next -- ?? 0 fallback for refs absent from order; filtered arrays only hold real refs */
    (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const byRef = (a: string, b: string) => a.localeCompare(b);

  /** Orders this book's honored refs canonically, keeping the unhonored ones after them. */
  const canonicalize = (refs: string[], isHonored: (ref: string) => boolean) => {
    const deduped = [...new Set(refs)];
    const mine = deduped.filter((ref) => bookOfRef(ref) === verseBook.bookRef);
    const foreign = deduped.filter((ref) => bookOfRef(ref) !== verseBook.bookRef);
    return [
      ...mine.filter(isHonored).sort(byOrder),
      ...mine.filter((ref) => !isHonored(ref)).sort(byRef),
      ...foreign.sort(byRef),
    ];
  };

  return {
    removedVerseStarts: canonicalize(delta.removedVerseStarts, honors.removal),
    addedStarts: canonicalize(delta.addedStarts, honors.addition),
  };
}

/**
 * Makes a token begin a segment — that is, splits before it. A default verse start that had been
 * merged away is un-merged; any other token is recorded as an added start. Already being a segment
 * start is a no-op.
 *
 * An edit at a ref is authoritative over any anchor drift has left there, so the token begins a
 * segment whichever kind of anchor already named it.
 */
export function addBoundaryBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  const { defaults } = bookLookups(verseBook);
  const removedVerseStarts = current.removedVerseStarts.filter((r) => r !== ref);
  const addedStarts = current.addedStarts.filter((r) => r !== ref);
  if (defaults.has(ref)) return normalize(verseBook, { removedVerseStarts, addedStarts });
  return normalize(verseBook, { removedVerseStarts, addedStarts: [...addedStarts, ref] });
}

/**
 * Stops a token from beginning a segment, merging it into the preceding one. A default verse start
 * is recorded as removed; a previously added split is dropped. Removing a default start with
 * nothing to merge into is a no-op, which covers the book's first verse and any verse following a
 * token-less verse marker.
 *
 * An edit at a ref is authoritative over any anchor drift has left there, so the token stops
 * beginning a segment whichever kind of anchor already named it.
 */
export function removeBoundaryAt(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  const current = delta ?? EMPTY_DELTA;
  const lookups = bookLookups(verseBook);
  const { defaults, mergeable } = lookups;
  if (defaults.has(ref) && !mergeable.has(ref)) return normalize(verseBook, current);
  const removedVerseStarts = current.removedVerseStarts.filter((r) => r !== ref);
  const addedStarts = current.addedStarts.filter((r) => r !== ref);
  if (defaults.has(ref))
    return normalize(verseBook, { removedVerseStarts: [...removedVerseStarts, ref], addedStarts });
  return normalize(verseBook, { removedVerseStarts, addedStarts });
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
 * Merges a segment into the one before it, identified by the first-token ref of the _second_
 * segment — the one absorbed into its predecessor. Clearing that token's segment start is the whole
 * operation, so a segment with no predecessor to merge into is a no-op; the separate name states
 * the merge intent.
 */
export function mergeSegments(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  secondSegmentStartRef: string,
): SegmentationDelta {
  return removeBoundaryAt(verseBook, delta, secondSegmentStartRef);
}

/**
 * Splits a segment so a new one begins at the given token. Making that token a segment start is the
 * whole operation, so a token that already begins one is unchanged; the separate name states the
 * split intent.
 */
export function splitSegmentBefore(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
  ref: string,
): SegmentationDelta {
  return addBoundaryBefore(verseBook, delta, ref);
}

/**
 * Whether the delta records no boundary edit at all, in any book: absent, or both arrays empty.
 * Such a delta leaves every book on the default verse segmentation.
 */
export function isEmptyDelta(delta: SegmentationDelta | undefined): boolean {
  return !delta || (delta.removedVerseStarts.length === 0 && delta.addedStarts.length === 0);
}

/**
 * Whether the delta leaves `verseBook` on the default verse segmentation. One delta spans every
 * book of its draft, so a delta that is custom overall may still say nothing about this book.
 */
export function isDefaultSegmentationForBook(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
): boolean {
  if (!delta) return true;
  return ![...delta.removedVerseStarts, ...delta.addedStarts].some(
    (ref) => bookOfRef(ref) === verseBook.bookRef,
  );
}

/**
 * The user's boundaries the loaded book no longer carries, named by the delta ref that recorded
 * each, in delta order — the boundaries {@link effectiveStarts} silently drops, which a reversified
 * or upstream-edited source produces because both re-key the token refs the delta is written
 * against.
 *
 * What counts is whether the boundary is absent, not whether its delta entry still changes
 * anything: a merge stranded mid-verse is lost, while a split whose token has become a verse start
 * is merely redundant.
 *
 * Only refs naming `verseBook` are considered, one delta spanning every book of its draft. The
 * delta is left intact either way, so a source that reverts brings its boundaries back.
 */
export function lostBoundaries(
  verseBook: Book,
  delta: SegmentationDelta | undefined,
): readonly string[] {
  if (!delta) return [];
  const lookups = bookLookups(verseBook);
  const honors = honorsAnchor(lookups);
  const { all } = lookups;
  const isMine = (ref: string) => bookOfRef(ref) === verseBook.bookRef;
  return [
    ...delta.removedVerseStarts.filter((ref) => isMine(ref) && !honors.removal(ref)),
    // A token that has become a default start carries the boundary itself.
    ...delta.addedStarts.filter((ref) => isMine(ref) && !all.has(ref)),
  ];
}
