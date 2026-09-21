import type {
  AnalysisLink,
  Book,
  SegmentAnalysis,
  TextAnalysis,
  Token,
  TokenSnapshot,
} from 'interlinearizer';
import { bookOfRef } from './analysis-book';
import { normalizeSurfaceForm } from './analysis-identity';

/**
 * Where a link's stored token snapshot now points: either the token ref it re-anchors to, or
 * nothing when the token it was written against is gone from its segment.
 */
type Anchor = string | undefined;

/** Returns the verse a token ref belongs to. */
function verseOfTokenRef(tokenRef: string): string {
  return tokenRef.slice(0, tokenRef.lastIndexOf(':'));
}

/** Counts how many times each value occurs. */
function countByValue(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return counts;
}

/**
 * The normalized forms a stored position can place unambiguously — those whose occurrences the
 * analysis accounts for one-for-one, the verse holding exactly as many as the analysis stored.
 *
 * A form covered only in part, or one that lost an occurrence, leaves the text no record of which
 * occurrence a stored gloss meant.
 */
function unambiguousForms(stored: string[], current: string[]): Set<string> {
  const storedCounts = countByValue(stored);
  const forms = new Set<string>();
  countByValue(current).forEach((count, form) => {
    if (count === storedCounts.get(form)) forms.add(form);
  });
  return forms;
}

/**
 * Pairs the surface forms an analysis was written against with the tokens now in the verse, giving
 * each stored form the token ref it should carry.
 *
 * Matching is positional rather than by-value so a repeated form lands on the right occurrence: the
 * second `"the"` of a verse re-anchors to the second `"the"` that survived, not the first. Forms
 * that differ only by capitalization or Unicode form still pair, so neither alone orphans a link. A
 * form with no counterpart yields `undefined`. Both sequences must be in document order.
 *
 * A form whose occurrences the analysis does not account for one-for-one yields `undefined` rather
 * than an arbitrary occurrence, so a partly-glossed or part-deleted repeated word goes stale for
 * review instead of landing on the wrong twin.
 */
function alignForms(stored: string[], tokens: Token[]): Anchor[] {
  const a = stored.map(normalizeSurfaceForm);
  const b = tokens.map((t) => normalizeSurfaceForm(t.surfaceText));
  const unambiguous = unambiguousForms(a, b);

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
      if (unambiguous.has(a[i])) anchors[i] = tokens[j].ref;
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
 * Groups the book's tokens by the verse each one's own ref names, in document order — so a custom
 * segmentation that merges several verses into one segment still yields each verse separately.
 */
function tokensByVerse(book: Book): Map<string, Token[]> {
  const byVerse = new Map<string, Token[]>();
  book.segments.forEach((segment) =>
    segment.tokens.forEach((token) => {
      const verse = verseOfTokenRef(token.ref);
      const group = byVerse.get(verse);
      if (group) group.push(token);
      else byVerse.set(verse, [token]);
    }),
  );
  return byVerse;
}

/**
 * Builds the re-anchor map for one book: every token ref the analysis mentions within that book,
 * mapped to where it now belongs.
 *
 * Each verse is re-anchored independently, since a token never migrates between verses and a verse
 * whose own text is untouched must not shift because a neighbor changed. One token ref resolves to
 * one anchor however many links name it.
 */
function buildAnchorMap(snapshots: TokenSnapshot[], book: Book): Map<string, Anchor> {
  const byVerse = tokensByVerse(book);

  // Deduplicated by token ref: a token named by several links contributes a snapshot from each, and
  // aligning the same word twice would consume two current tokens and orphan one copy.
  const uniqueSnapshots = new Map<string, TokenSnapshot>();
  snapshots.forEach((snapshot) => {
    if (!uniqueSnapshots.has(snapshot.tokenRef)) uniqueSnapshots.set(snapshot.tokenRef, snapshot);
  });

  // Keyed by the verse's token list rather than its ref so the alignment below needs no second
  // lookup, which would have to answer for a verse this grouping already dropped.
  const grouped = new Map<Token[], TokenSnapshot[]>();
  uniqueSnapshots.forEach((snapshot) => {
    const tokens = byVerse.get(verseOfTokenRef(snapshot.tokenRef));
    if (!tokens) return;
    const group = grouped.get(tokens);
    if (group) group.push(snapshot);
    else grouped.set(tokens, [snapshot]);
  });

  const anchorMap = new Map<string, Anchor>();
  grouped.forEach((group, tokens) => {
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
 * @returns The snapshot to keep, `changed` when it took a new ref, and `orphaned` when the map
 *   could not place it — its token is gone, or its form is too ambiguous to place. A snapshot
 *   outside the book being re-anchored comes back untouched and neither changed nor orphaned.
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

/**
 * Whether a segment link's stored baseline has fallen out of step with the segment it names. A
 * segment the loaded book does not hold counts as undrifted, having no evidence either way.
 */
function hasDriftedBaseline(
  segmentId: string,
  analysisId: string,
  segmentAnalyses: SegmentAnalysis[],
  book: Book,
): boolean {
  const segment = book.segments.find((s) => s.id === segmentId);
  if (!segment) return false;
  const stored = segmentAnalyses.find((a) => a.id === analysisId);
  return stored !== undefined && stored.surfaceText !== segment.baselineText;
}

/** Marks a link stale and stamps it, returning an already-stale one unchanged. */
function markStale<T extends AnalysisLink>(link: T, now: string): T {
  return link.status === 'stale' ? link : { ...link, status: 'stale', updatedAt: now };
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
 * cause, and it does not attempt to follow a word whose own spelling was edited or to choose
 * between identical words the analysis does not cover in full. A snapshot with no counterpart
 * leaves its link at the ref it was written against and flips the link to `'stale'`, so the record
 * survives for review rather than being silently dropped or silently misattached. Future work
 * should resist growing this into a general diff — the cost of a wrong match is a gloss on the
 * wrong word, which is worse than an honest `'stale'`.
 *
 * A segment analysis has no offsets to heal, so it is checked rather than re-anchored: a stored
 * baseline that no longer matches the segment's own goes `'stale'`, a free translation of since-
 * changed text no longer being a claim about what the segment says. Every link the pass rewrites
 * takes `now` as its `updatedAt`.
 *
 * @returns The healed analysis, or `analysis` itself when nothing moved — so an unchanged book
 *   neither reseeds the store nor marks the draft dirty.
 */
export function reanchorAnalysisToBook(
  analysis: TextAnalysis,
  book: Book,
  now: string,
): TextAnalysis {
  const inBook = (tokenRef: string) => bookOfRef(tokenRef) === book.bookRef;

  const snapshots: TokenSnapshot[] = [
    ...analysis.tokenAnalysisLinks.map((l) => l.token),
    ...analysis.phraseAnalysisLinks.flatMap((l) => l.tokens),
  ].filter((s) => inBook(s.tokenRef));

  const anchorMap = buildAnchorMap(snapshots, book);
  let changed = false;

  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.map((link) => {
    const result = reanchorSnapshot(link.token, anchorMap);
    if (result.orphaned) {
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    if (!result.changed) return link;
    changed = true;
    return { ...link, token: result.snapshot, updatedAt: now };
  });

  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.map((link) => {
    const results = link.tokens.map((token) => reanchorSnapshot(token, anchorMap));
    if (results.some((r) => r.orphaned)) {
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    if (!results.some((r) => r.changed)) return link;
    changed = true;
    return { ...link, tokens: results.map((r) => r.snapshot), updatedAt: now };
  });

  const segmentAnalysisLinks = analysis.segmentAnalysisLinks.map((link) => {
    if (!hasDriftedBaseline(link.segmentId, link.analysisId, analysis.segmentAnalyses, book))
      return link;
    const stale = markStale(link, now);
    changed ||= stale !== link;
    return stale;
  });

  if (!changed) return analysis;
  return { ...analysis, tokenAnalysisLinks, phraseAnalysisLinks, segmentAnalysisLinks };
}
