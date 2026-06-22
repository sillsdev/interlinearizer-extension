/**
 * @file Re-groups a verse-tokenized {@link Book} into the user's custom segments per a
 *   {@link SegmentationDelta}, without touching the text-layer tokenizer.
 *
 *   {@link tokenizeBook} always produces one `Segment` per verse; this pass runs on its output and
 *   cuts the flat document-order token stream at the delta's effective boundaries. Token refs and
 *   token objects are preserved unchanged for untouched verses (reused by reference) so analyses
 *   keep resolving and React memoization is undisturbed; only merged or split segments are rebuilt,
 *   with `baselineText` and per-token char offsets recomputed so the `baselineText.slice(charStart,
 *   charEnd) === surfaceText` invariant still holds.
 */
import type { Book, ScriptureRef, Segment, SegmentationDelta, Token } from 'interlinearizer';

import { effectiveStarts, isDefaultSegmentation } from '../../utils/segmentation';

/** Separator inserted between two verses' baseline text when they are merged into one segment. */
const MERGE_SEPARATOR = ' ';

/** A token paired with the original verse {@link Segment} it came from. */
type SourcedToken = { token: Token; verse: Segment };

/**
 * Rebuilds one custom {@link Segment} from a run of tokens that may span multiple original verses.
 * The new `baselineText` is each contributing verse's text spliced to its covered span, joined by
 * {@link MERGE_SEPARATOR} between verses; every token's char offset is shifted into the new string
 * while its `ref` and `surfaceText` are preserved.
 *
 * @param run - The run's tokens in document order, each tagged with its source verse. Non-empty.
 * @returns The rebuilt segment.
 */
function buildSegment(run: SourcedToken[]): Segment {
  const firstSourced = run[0];
  const lastSourced = run[run.length - 1];
  const firstVerse = firstSourced.verse;
  const lastVerse = lastSourced.verse;

  // A segment that begins at its first verse's first token keeps that verse's id (so an untouched or
  // merged segment preserves the leading verse's segment-level analyses); a segment that begins
  // mid-verse (a split's later piece) takes its first token's ref as a fresh, unique id.
  const startsAtVerseBoundary = firstSourced.token.ref === firstVerse.tokens[0]?.ref;
  const id = startsAtVerseBoundary ? firstVerse.id : firstSourced.token.ref;

  let baselineText = '';
  let cursor = 0;
  let runIndex = 0;
  const tokens: Token[] = [];
  while (runIndex < run.length) {
    const { verse } = run[runIndex];
    if (runIndex > 0) {
      baselineText += MERGE_SEPARATOR;
      cursor += MERGE_SEPARATOR.length;
    }
    // Consume the contiguous sub-run of tokens from this verse, shifting each token's offsets into
    // the new concatenated baseline while keeping its ref and surface text unchanged.
    const subStart = runIndex;
    const base = run[subStart].token.charStart;
    while (runIndex < run.length && run[runIndex].verse === verse) {
      const { token } = run[runIndex];
      tokens.push({
        ...token,
        charStart: cursor + (token.charStart - base),
        charEnd: cursor + (token.charEnd - base),
      });
      runIndex += 1;
    }
    const lastCharEnd = run[runIndex - 1].token.charEnd;
    const piece = verse.baselineText.slice(base, lastCharEnd);
    baselineText += piece;
    cursor += piece.length;
  }

  // Anchor the new range to the covered span; a mid-verse edge carries a sub-verse charIndex.
  const startRef: ScriptureRef = startsAtVerseBoundary
    ? firstVerse.startRef
    : { ...firstVerse.startRef, charIndex: firstSourced.token.charStart };
  const endsAtVerseBoundary =
    lastSourced.token.ref === lastVerse.tokens[lastVerse.tokens.length - 1]?.ref;
  const endRef: ScriptureRef = endsAtVerseBoundary
    ? lastVerse.endRef
    : { ...lastVerse.endRef, charIndex: lastSourced.token.charEnd };

  return { id, startRef, endRef, baselineText, tokens };
}

/**
 * Re-groups `book`'s verse segments into the user's custom segments per `delta`.
 *
 * Returns `book` unchanged (by reference) for the default segmentation, so the common no-custom-
 * boundaries case incurs no work and no identity churn. Otherwise the flat token stream is cut at
 * the effective boundaries; a run that is exactly one original verse reuses that verse's `Segment`
 * object verbatim, while merged or split runs are rebuilt via {@link buildSegment}.
 *
 * @param book - The verse-tokenized book from {@link tokenizeBook}.
 * @param delta - The user's boundary delta, or `undefined` for the default verse segmentation.
 * @returns A book with the custom segmentation applied, or `book` itself when `delta` is the
 *   default.
 */
export function resegmentBook(book: Book, delta: SegmentationDelta | undefined): Book {
  if (isDefaultSegmentation(delta)) return book;

  const starts = effectiveStarts(book, delta);

  // Cut the flat token stream into runs, beginning a new run at each effective start (but never
  // splitting off a run that has no word/structural content yet — leading tokens stay with the
  // first run).
  const runs: SourcedToken[][] = [];
  let current: SourcedToken[] = [];
  book.segments.forEach((verse) => {
    verse.tokens.forEach((token) => {
      if (starts.has(token.ref) && current.length > 0) {
        runs.push(current);
        current = [];
      }
      current.push({ token, verse });
    });
  });
  /* v8 ignore next -- a non-default delta always yields at least one token, so current is non-empty */
  if (current.length > 0) runs.push(current);

  const segments: Segment[] = runs.map((run) => {
    const firstVerse = run[0].verse;
    // Reuse the original verse Segment when the run is exactly that verse — preserves its id,
    // baselineText, token offsets, and object identity.
    const isWholeUntouchedVerse =
      run.length === firstVerse.tokens.length && run.every((s) => s.verse === firstVerse);
    return isWholeUntouchedVerse ? firstVerse : buildSegment(run);
  });

  return { ...book, segments };
}
