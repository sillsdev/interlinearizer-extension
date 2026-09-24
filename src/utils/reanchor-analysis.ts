import type { AnalysisLink, Book, TextAnalysis, Token, TokenSnapshot } from 'interlinearizer';
import { bookOfRef } from './analysis-book';
import { normalizeSurfaceForm } from './analysis-identity';

/**
 * Where a link's stored token snapshot now points: either the token ref it re-anchors to, or
 * nothing when the token it was written against is gone from its segment.
 */
type Anchor = string | undefined;

/** Returns the id of the segment a token ref belongs to. */
function segmentOfTokenRef(tokenRef: string): string {
  return tokenRef.slice(0, tokenRef.lastIndexOf(':'));
}

/**
 * Pairs the surface forms an analysis was written against with the tokens now in the segment,
 * giving each stored form the token ref it should carry.
 *
 * Matching is positional rather than by-value so a repeated form lands on the right occurrence: the
 * second `"the"` of a verse re-anchors to the second `"the"` that survived, not the first. Forms
 * that differ only by capitalization or Unicode form still pair, so neither alone orphans a link. A
 * form with no counterpart yields `undefined`. Both sequences must be in document order.
 */
function alignForms(stored: string[], tokens: Token[]): Anchor[] {
  const a = stored.map(normalizeSurfaceForm);
  const b = tokens.map((t) => normalizeSurfaceForm(t.surfaceText));

  // lengths[i][j] — the LCS length of a.slice(i) against b.slice(j), filled back-to-front so the
  // forward walk below can pick the branch that keeps the most pairings.
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const anchors: Anchor[] = new Array<Anchor>(a.length).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      anchors[i] = tokens[j].ref;
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return anchors;
}

/**
 * Builds the re-anchor map for one book: every token ref the analysis mentions within that book,
 * mapped to where it now belongs.
 *
 * Each segment is re-anchored independently, since a token never migrates between verses and a
 * verse whose own text is untouched must not shift because a neighbor changed.
 */
function buildAnchorMap(snapshots: TokenSnapshot[], book: Book): Map<string, Anchor> {
  const tokensBySegment = new Map(book.segments.map((s) => [s.id, s.tokens]));

  // Keyed by the segment's token list rather than its id so the alignment below needs no second
  // lookup, which would have to answer for a segment this grouping already dropped.
  const bySegment = new Map<Token[], TokenSnapshot[]>();
  snapshots.forEach((snapshot) => {
    const tokens = tokensBySegment.get(segmentOfTokenRef(snapshot.tokenRef));
    if (!tokens) return;
    const group = bySegment.get(tokens);
    if (group) group.push(snapshot);
    else bySegment.set(tokens, [snapshot]);
  });

  const anchorMap = new Map<string, Anchor>();
  bySegment.forEach((group, tokens) => {
    const ordered = [...group].sort(
      (x, y) => offsetOfTokenRef(x.tokenRef) - offsetOfTokenRef(y.tokenRef),
    );
    const anchors = alignForms(
      ordered.map((s) => s.surfaceText),
      tokens,
    );
    ordered.forEach((snapshot, index) => anchorMap.set(snapshot.tokenRef, anchors[index]));
  });
  return anchorMap;
}

/** Returns the character offset within the verse that a token ref names. */
function offsetOfTokenRef(tokenRef: string): number {
  return Number(tokenRef.slice(tokenRef.lastIndexOf(':') + 1));
}

/**
 * Applies the re-anchor map to one snapshot.
 *
 * @returns The snapshot to keep, `changed` when it took a new ref, and `orphaned` when its token is
 *   gone from the book. A snapshot outside the book being re-anchored comes back untouched and
 *   neither changed nor orphaned.
 */
function reanchorSnapshot(
  snapshot: TokenSnapshot,
  anchorMap: Map<string, Anchor>,
): { snapshot: TokenSnapshot; changed: boolean; orphaned: boolean } {
  if (!anchorMap.has(snapshot.tokenRef)) {
    return { snapshot, changed: false, orphaned: false };
  }
  const anchor = anchorMap.get(snapshot.tokenRef);
  if (anchor === undefined) return { snapshot, changed: false, orphaned: true };
  if (anchor === snapshot.tokenRef) return { snapshot, changed: false, orphaned: false };
  return { snapshot: { ...snapshot, tokenRef: anchor }, changed: true, orphaned: false };
}

/** Marks a link stale, returning an already-stale one unchanged. */
function markStale<T extends AnalysisLink>(link: T): T {
  return link.status === 'stale' ? link : { ...link, status: 'stale' };
}

/**
 * Re-points a project's analysis at the tokens of a freshly tokenized book, healing the links an
 * upstream text edit would otherwise strand. The analysis spans every book; records outside the one
 * given are carried through untouched.
 *
 * A token's ref embeds its character offset within the verse (`"GEN 1:1:7"`), so inserting or
 * deleting text earlier in the verse re-keys every token after it. Left alone, a stored link keeps
 * naming an offset that now belongs to a different word, and its analysis appears to jump to that
 * word.
 *
 * The alignment is deliberately modest: it recovers insertions, deletions and the shifts they
 * cause, and it does not attempt to follow a word whose own spelling was edited. A snapshot with no
 * counterpart leaves its link at the ref it was written against and flips the link to `'stale'`, so
 * the record survives for review rather than being silently dropped or silently misattached. Future
 * work should resist growing this into a general diff — the cost of a wrong match is a gloss on the
 * wrong word, which is worse than an honest `'stale'`.
 *
 * @returns The healed analysis, or `analysis` itself when nothing moved — so an unchanged book
 *   neither reseeds the store nor marks the draft dirty.
 */
export function reanchorAnalysisToBook(analysis: TextAnalysis, book: Book): TextAnalysis {
  const inBook = (tokenRef: string) => bookOfRef(tokenRef) === book.bookRef;

  const snapshots: TokenSnapshot[] = [
    ...analysis.tokenAnalysisLinks.map((l) => l.token),
    ...analysis.phraseAnalysisLinks.flatMap((l) => l.tokens),
  ].filter((s) => inBook(s.tokenRef));
  if (snapshots.length === 0) return analysis;

  const anchorMap = buildAnchorMap(snapshots, book);
  let changed = false;

  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.map((link) => {
    const result = reanchorSnapshot(link.token, anchorMap);
    if (result.orphaned) {
      const stale = markStale(link);
      changed ||= stale !== link;
      return stale;
    }
    if (!result.changed) return link;
    changed = true;
    return { ...link, token: result.snapshot };
  });

  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.map((link) => {
    const results = link.tokens.map((token) => reanchorSnapshot(token, anchorMap));
    if (results.some((r) => r.orphaned)) {
      const stale = markStale(link);
      changed ||= stale !== link;
      return stale;
    }
    if (!results.some((r) => r.changed)) return link;
    changed = true;
    return { ...link, tokens: results.map((r) => r.snapshot) };
  });

  if (!changed) return analysis;
  return { ...analysis, tokenAnalysisLinks, phraseAnalysisLinks };
}
