import type {
  Book,
  ScriptureRef,
  Segment,
  SegmentationDelta,
  Token,
  VerseStart,
} from 'interlinearizer';

import { effectiveStarts, isDefaultSegmentation } from '../../utils/segmentation';

/** Separator inserted between two verses' baseline text when they are merged into one segment. */
const MERGE_SEPARATOR = ' ';

/** A token paired with the original verse {@link Segment} it came from. */
type SourcedToken = { token: Token; verse: Segment };

/**
 * Rebuilds one custom {@link Segment} from a run of tokens that may span multiple original verses.
 * The new `baselineText` is each contributing verse's text spliced to its covered span, joined by
 * {@link MERGE_SEPARATOR} between verses; every token's char offset is shifted into the new string
 * while its `ref` and `surfaceText` are preserved. One `verseStarts` entry is emitted per
 * contributing verse, at its offset in the concatenated baseline, carrying that verse's rendered
 * number (a split's later piece keeps its source verse's number).
 *
 * @param run - The run's tokens in document order, each tagged with its source verse. Non-empty.
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
  const verseStarts: VerseStart[] = [];
  while (runIndex < run.length) {
    const { verse } = run[runIndex];
    if (runIndex > 0) {
      baselineText += MERGE_SEPARATOR;
      cursor += MERGE_SEPARATOR.length;
    }
    // Each contributing verse begins at the current cursor in the concatenated baseline, carrying
    // its source verse's rendered number and chapter (the latter lets the renderer qualify chapter
    // transitions without inspecting a token). The run's FIRST verse start is flagged a continuation
    // when this segment begins mid-verse (a split's later piece): the verse truly started in an
    // earlier segment, so the flag keeps containment for navigation without repeating the number.
    // Every later verse in a merged run genuinely starts here and is never a continuation.
    verseStarts.push({
      charStart: cursor,
      /* v8 ignore next -- every original verse segment has exactly one verse start */
      number: verse.verseStarts[0]?.number ?? '',
      chapter: verse.startRef.chapter,
      ...(runIndex === 0 && !startsAtVerseBoundary ? { isContinuation: true } : {}),
    });
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

  return { id, startRef, endRef, baselineText, tokens, verseStarts };
}

/**
 * Re-groups a verse-tokenized {@link Book} into the user's custom segments, without touching the
 * text-layer tokenizer.
 *
 * The book is returned unchanged, by reference, for the default segmentation, so the common
 * no-custom-boundaries case incurs no work and no identity churn. Otherwise the flat document-order
 * token stream is cut at the delta's effective boundaries. A run that is exactly one original verse
 * reuses that verse's segment verbatim, so analyses keep resolving and React memoization is
 * undisturbed; only merged or split runs are rebuilt, with baseline text and char offsets
 * recomputed so the `baselineText.slice(charStart, charEnd) === surfaceText` invariant still
 * holds.
 *
 * Token-less verses (empty verse markers) pass through as their own segments in document order, so
 * they survive a custom segmentation exactly as they do the default one.
 */
export function resegmentBook(book: Book, delta: SegmentationDelta | undefined): Book {
  if (isDefaultSegmentation(delta)) return book;

  const starts = effectiveStarts(book, delta);

  // Cut the flat token stream into runs, beginning a new run at each effective start. Runs are
  // materialized into segments in document order as they close, interleaved with any token-less
  // verses (empty verse markers): those carry no token to anchor a boundary, so each stands as its
  // own segment, reused verbatim.
  const segments: Segment[] = [];
  let current: SourcedToken[] = [];

  /** Materializes the open run (if any) into a segment and resets it. */
  const flushRun = () => {
    if (current.length === 0) return;
    const run = current;
    current = [];
    const firstVerse = run[0].verse;
    // Reuse the original verse Segment when the run is exactly that verse — preserves its id,
    // baselineText, token offsets, and object identity.
    const isWholeUntouchedVerse =
      run.length === firstVerse.tokens.length && run.every((s) => s.verse === firstVerse);
    segments.push(isWholeUntouchedVerse ? firstVerse : buildSegment(run));
  };

  book.segments.forEach((verse) => {
    // An empty verse has no token to start a run or be absorbed into one, so flush whatever run is
    // open and pass the empty verse's original Segment through unchanged, keeping it in document
    // order rather than silently dropping it.
    if (verse.tokens.length === 0) {
      flushRun();
      segments.push(verse);
      return;
    }
    verse.tokens.forEach((token) => {
      if (starts.has(token.ref)) flushRun();
      current.push({ token, verse });
    });
  });
  flushRun();

  return { ...book, segments };
}
