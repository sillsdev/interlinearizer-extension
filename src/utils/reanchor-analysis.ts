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
export function verseOfTokenRef(tokenRef: string): string {
  return tokenRef.slice(0, tokenRef.lastIndexOf(':'));
}

/**
 * The key a snapshot re-anchors under: its ref paired with the form it was written against.
 *
 * A ref alone would conflate a stale analysis with the one that replaced it, which legitimately
 * share a ref while naming different words.
 */
function snapshotKey(snapshot: TokenSnapshot): string {
  return `${snapshot.tokenRef}\u0000${normalizeSurfaceForm(snapshot.surfaceText)}`;
}

/** Counts how many times each value occurs. */
function countByValue(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return counts;
}

/**
 * The normalized forms a gloss may be placed on without choosing between identical words.
 *
 * The stored sequence covers only the tokens the analysis glossed, never the whole verse, so it
 * cannot testify how often a form occurred before an edit. A form is placeable only on the evidence
 * it does carry: every stored occurrence found a counterpart, and the verse holds exactly as many
 * of the form as were stored. A spare occurrence means the pairing was chosen rather than forced —
 * glosses on two of three identical words could as easily be the first two as the last two.
 *
 * One ambiguity survives, being unresolvable from a {@link TokenSnapshot}: a form stored once whose
 * occurrence was deleted, leaving one unglossed twin, presents exactly as that gloss shifted along
 * by an edit.
 *
 * @param paired - For each stored position, the token index it aligned to, or `undefined`.
 */
function unambiguousForms(
  stored: string[],
  current: string[],
  paired: (number | undefined)[],
): Set<string> {
  const storedCounts = countByValue(stored);
  const currentCounts = countByValue(current);
  const unpaired = new Set<string>();
  stored.forEach((form, index) => {
    if (paired[index] === undefined) unpaired.add(form);
  });
  return new Set(
    stored.filter((form) => {
      if (unpaired.has(form)) return false;
      return storedCounts.get(form) === currentCounts.get(form);
    }),
  );
}

/**
 * Pairs each stored form with the index of the current form it aligns to in order, or `undefined`
 * where it has no counterpart or is too ambiguous to place.
 */
function pairUnambiguously(a: string[], b: string[]): (number | undefined)[] {
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

  const paired: (number | undefined)[] = new Array<number | undefined>(a.length).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      paired[i] = j;
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const unambiguous = unambiguousForms(a, b, paired);
  return paired.map((tokenIndex, index) =>
    tokenIndex !== undefined && unambiguous.has(a[index]) ? tokenIndex : undefined,
  );
}

/**
 * Pairs the surface forms an analysis was written against with the tokens now in the verse, giving
 * each stored form the token ref it should carry.
 *
 * Matching is positional rather than by-value so a repeated form lands on the right occurrence: the
 * second `"the"` of a verse re-anchors to the second `"the"` that survived, not the first. Forms
 * that differ only by capitalization or Unicode form still pair, so neither alone orphans a link. A
 * form with no counterpart yields `undefined`. Both sequences must be in document order, and
 * `storedRefs` must be the refs of `stored`, position for position.
 *
 * A form too ambiguous to place yields `undefined` rather than an arbitrary occurrence, so a
 * part-deleted repeated word goes stale for review instead of landing on the wrong twin.
 */
function alignForms(stored: string[], storedRefs: string[], tokens: Token[]): Anchor[] {
  const a = stored.map(normalizeSurfaceForm);
  const b = tokens.map((t) => normalizeSurfaceForm(t.surfaceText));

  // A stored position whose own ref still names a token of its form has not moved, whatever the
  // alignment would pair it with — the ref is better evidence of which twin a gloss meant. Not so
  // for a form that lost an occurrence, where a surviving twin may have shifted onto the ref.
  const currentCounts = countByValue(b);
  const depletedForms = new Set(
    [...countByValue(a)]
      .filter(([form, count]) => count > (currentCounts.get(form) ?? 0))
      .map(([form]) => form),
  );
  const indexByRef = new Map(tokens.map((token, index) => [token.ref, index]));
  const settled = a.map((form, index) => {
    if (depletedForms.has(form)) return undefined;
    const tokenIndex = indexByRef.get(storedRefs[index]);
    return tokenIndex !== undefined && b[tokenIndex] === form ? tokenIndex : undefined;
  });

  // Settled pairings are withheld from the alignment, so they neither count toward ambiguity nor
  // can be consumed by a moved sibling.
  const claimed = new Set(settled);
  const openStored = a.flatMap((_, index) => (settled[index] === undefined ? [index] : []));
  const openTokens = b.flatMap((_, index) => (claimed.has(index) ? [] : [index]));
  const openPaired = pairUnambiguously(
    openStored.map((index) => a[index]),
    openTokens.map((index) => b[index]),
  );

  const anchors: Anchor[] = settled.map((tokenIndex) =>
    tokenIndex === undefined ? undefined : tokens[tokenIndex].ref,
  );
  openStored.forEach((storedIndex, openIndex) => {
    const openTokenIndex = openPaired[openIndex];
    if (openTokenIndex !== undefined) anchors[storedIndex] = tokens[openTokens[openTokenIndex]].ref;
  });
  return anchors;
}

/**
 * Groups the book's tokens by the verse each one's own ref names, in document order — so a custom
 * segmentation that merges several verses into one segment still yields each verse separately.
 *
 * A verse the book holds but that carries no tokens gets an empty group rather than no entry, so
 * emptying a verse's text orphans its analyses instead of leaving them pointing at nothing.
 */
function tokensByVerse(book: Book): Map<string, Token[]> {
  const byVerse = new Map<string, Token[]>();
  book.segments.forEach((segment) => {
    if (segment.tokens.length === 0) {
      if (!byVerse.has(segment.id)) byVerse.set(segment.id, []);
      return;
    }
    segment.tokens.forEach((token) => {
      const verse = verseOfTokenRef(token.ref);
      const group = byVerse.get(verse);
      if (group) group.push(token);
      else byVerse.set(verse, [token]);
    });
  });
  return byVerse;
}

/**
 * Builds the re-anchor map for one book: every token the analysis mentions within that book, keyed
 * by ref and stored form together, mapped to where it now belongs.
 *
 * Each verse is re-anchored independently, since a token never migrates between verses and a verse
 * whose own text is untouched must not shift because a neighbor changed. Links naming one ref with
 * one stored form resolve together, however many of them there are; links that disagree about the
 * word at a ref each get their own answer.
 */
function buildAnchorMap(snapshots: TokenSnapshot[], book: Book): Map<string, Anchor> {
  const byVerse = tokensByVerse(book);

  // Deduplicated: a token named by several links contributes a snapshot from each, and aligning the
  // same word twice would consume two current tokens and orphan one copy.
  const uniqueSnapshots = new Map<string, TokenSnapshot>();
  snapshots.forEach((snapshot) => uniqueSnapshots.set(snapshotKey(snapshot), snapshot));

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
      ordered.map((s) => s.tokenRef),
      tokens,
    );
    ordered.forEach((snapshot, index) => anchorMap.set(snapshotKey(snapshot), anchors[index]));
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
 * @returns The snapshot to keep, `changed` when it took a new ref, `orphaned` when the map could
 *   not place it — its token is gone, or its form is too ambiguous to place — and `placed` when the
 *   map did find it a token, whether or not that moved it. A snapshot outside the book being
 *   re-anchored comes back untouched, neither changed nor orphaned nor placed.
 */
function reanchorSnapshot(
  snapshot: TokenSnapshot,
  anchorMap: Map<string, Anchor>,
): { snapshot: TokenSnapshot; changed: boolean; orphaned: boolean; placed: boolean } {
  const key = snapshotKey(snapshot);
  if (!anchorMap.has(key)) {
    return { snapshot, changed: false, orphaned: false, placed: false };
  }
  const anchor = anchorMap.get(key);
  if (anchor === undefined) return { snapshot, changed: false, orphaned: true, placed: false };
  if (anchor === snapshot.tokenRef)
    return { snapshot, changed: false, orphaned: false, placed: true };
  return {
    snapshot: { ...snapshot, tokenRef: anchor },
    changed: true,
    orphaned: false,
    placed: true,
  };
}

/**
 * Re-points each snapshot at the token it now names in `book`, returning a snapshot that cannot be
 * placed, or that names a verse the book does not hold, as it was.
 */
export function reanchorSnapshots(snapshots: TokenSnapshot[], book: Book): TokenSnapshot[] {
  const anchorMap = buildAnchorMap(snapshots, book);
  return snapshots.map((snapshot) => reanchorSnapshot(snapshot, anchorMap).snapshot);
}

/**
 * Whether a segment link's stored baseline has fallen out of step with the segment it names. A
 * segment of the loaded book's own that it no longer holds has drifted; one from another book
 * counts as undrifted, the loaded book having no evidence either way.
 *
 * A free translation is a claim about the whole segment, so it drifts as soon as the segment says
 * anything other than what it was written over — whether the words themselves changed or a boundary
 * moved to cover different ones.
 */
function hasDriftedBaseline(
  segmentId: string,
  analysisId: string,
  segmentAnalyses: SegmentAnalysis[],
  book: Book,
): boolean {
  const segment = book.segments.find((s) => s.id === segmentId);
  if (!segment) return bookOfRef(segmentId) === book.bookRef;
  const stored = segmentAnalyses.find((a) => a.id === analysisId);
  /* v8 ignore next -- a link always accompanies the analysis payload it names */
  if (stored === undefined) return false;
  return segment.baselineText !== stored.surfaceText;
}

/**
 * Marks an approved link stale and stamps it, returning a link of any other status unchanged.
 *
 * Only an approval is this pass's to take away. A `'rejected'` or `'candidate'` link records a
 * review someone performed, and staling it would erase that verdict and leave it eligible for
 * promotion, so an edit undone upstream would return a rejection as the canonical analysis.
 */
function markStale<T extends AnalysisLink>(link: T, now: string): T {
  return link.status === 'approved' ? { ...link, status: 'stale', updatedAt: now } : link;
}

/**
 * Whether a link holds its token or segment against a stale one reviving onto it.
 *
 * A `'candidate'` holds it as firmly as an approval: it is the status a second analysis is demoted
 * to so one token keeps one approval, and reviving over it would restore that duplication.
 */
function occupies(link: AnalysisLink): boolean {
  return link.status === 'approved' || link.status === 'candidate';
}

/**
 * Returns a stale link to `'approved'`, stamping it, and leaves a link of any other status alone.
 *
 * `'approved'` is the status restored because it is the only one this pass takes away: a link it
 * never staled is not its to promote.
 */
function revive<T extends AnalysisLink>(link: T, now: string): T {
  return link.status === 'stale' ? { ...link, status: 'approved', updatedAt: now } : link;
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
 * leaves its link at the ref it was written against and flips an approval to `'stale'`, so the
 * record survives for review rather than being silently dropped or silently misattached. Future
 * work should resist growing this into a general diff — the cost of a wrong match is a gloss on the
 * wrong word, which is worse than an honest `'stale'`.
 *
 * Only approvals are staled and only stale links revived, so the pass gives back exactly what it
 * takes: a stale link whose snapshot places again returns to `'approved'`, restoring an analysis an
 * upstream edit stranded, while a verdict someone recorded — a rejection, a candidate — survives an
 * edit and its undoing untouched. A link stays stale where reviving it would give one token, one
 * phrase's token, or one segment, a second occupying link, so of two stale links contending for one
 * target only the earlier in the list revives.
 *
 * A segment analysis has no offsets to heal, so it is checked rather than re-anchored: a segment
 * whose text differs at all from the stored baseline — an edit to the words or a boundary moved to
 * cover different ones — stales its approval, a free translation of since-changed text no longer
 * being a claim about what the segment says, and returns to `'approved'` once the segment reads
 * exactly that way again. A translation of a split piece re-keyed by an edit earlier in its verse
 * follows that piece's boundary among `storedSplits`, the splits as stored before `book`
 * re-anchored them, staying stale there until the piece reads as before. Every link the pass
 * rewrites takes `now` as its `updatedAt`.
 *
 * @returns The healed analysis, or `analysis` itself when nothing moved — so an unchanged book
 *   neither reseeds the store nor marks the draft dirty.
 */
export function reanchorAnalysisToBook(
  analysis: TextAnalysis,
  book: Book,
  now: string,
  storedSplits: TokenSnapshot[] = [],
): TextAnalysis {
  const inBook = (tokenRef: string) => bookOfRef(tokenRef) === book.bookRef;

  const splitAnchorMap = buildAnchorMap(storedSplits, book);
  const movedSplits = new Map<string, string>();
  storedSplits.forEach((start) => {
    const result = reanchorSnapshot(start, splitAnchorMap);
    if (result.changed) movedSplits.set(start.tokenRef, result.snapshot.tokenRef);
  });

  const snapshots: TokenSnapshot[] = [
    ...analysis.tokenAnalysisLinks.map((l) => l.token),
    ...analysis.phraseAnalysisLinks.flatMap((l) => l.tokens),
  ].filter((s) => inBook(s.tokenRef));

  const anchorMap = buildAnchorMap(snapshots, book);
  let changed = false;

  // Where each occupying link ends up, not where it started, so reviving a stale one cannot make a
  // token's second. A link this pass stales occupies nothing, having given its token up.
  const occupiedElsewhere = new Set(
    analysis.tokenAnalysisLinks
      .filter(occupies)
      .map((l) => reanchorSnapshot(l.token, anchorMap))
      .filter((r) => !r.orphaned)
      .map((r) => r.snapshot.tokenRef),
  );

  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.map((link) => {
    const result = reanchorSnapshot(link.token, anchorMap);
    if (result.orphaned) {
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    const revived =
      result.placed && !occupiedElsewhere.has(result.snapshot.tokenRef) ? revive(link, now) : link;
    // So two stale links on one token cannot both come back.
    if (revived !== link) occupiedElsewhere.add(result.snapshot.tokenRef);
    if (!result.changed) {
      changed ||= revived !== link;
      return revived;
    }
    changed = true;
    return { ...revived, token: result.snapshot, updatedAt: now };
  });

  // Which tokens an occupying phrase holds, so reviving a stale one cannot give a token a second
  // approved phrase. A token's own parse is no obstacle — only another phrase is.
  const phraseOccupiedElsewhere = new Set(
    analysis.phraseAnalysisLinks
      .filter(occupies)
      .map((l) => l.tokens.map((token) => reanchorSnapshot(token, anchorMap)))
      .filter((results) => !results.some((r) => r.orphaned))
      .flatMap((results) => results.map((r) => r.snapshot.tokenRef)),
  );

  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.map((link) => {
    const results = link.tokens.map((token) => reanchorSnapshot(token, anchorMap));
    if (results.some((r) => r.orphaned)) {
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    const revived =
      results.every((r) => r.placed) &&
      !results.some((r) => phraseOccupiedElsewhere.has(r.snapshot.tokenRef))
        ? revive(link, now)
        : link;
    // So two stale phrases over a shared token cannot both come back.
    if (revived !== link) results.forEach((r) => phraseOccupiedElsewhere.add(r.snapshot.tokenRef));
    if (!results.some((r) => r.changed)) {
      changed ||= revived !== link;
      return revived;
    }
    changed = true;
    return { ...revived, tokens: results.map((r) => r.snapshot), updatedAt: now };
  });

  // Where an occupying translation already sits, so reviving a stale one cannot give a segment a
  // second.
  const occupiedSegments = new Set(
    analysis.segmentAnalysisLinks
      .filter(occupies)
      .filter((l) => !hasDriftedBaseline(l.segmentId, l.analysisId, analysis.segmentAnalyses, book))
      .map((l) => l.segmentId),
  );

  const segmentAnalysisLinks = analysis.segmentAnalysisLinks.map((link) => {
    if (hasDriftedBaseline(link.segmentId, link.analysisId, analysis.segmentAnalyses, book)) {
      // Follows its own boundary even while stale, since a later pass has no record of the move.
      const target = movedSplits.get(link.segmentId);
      if (target !== undefined) {
        const fits =
          !occupiedSegments.has(target) &&
          !hasDriftedBaseline(target, link.analysisId, analysis.segmentAnalyses, book);
        const moved = fits ? revive(link, now) : markStale(link, now);
        if (!occupies(moved) || fits) {
          if (occupies(moved)) occupiedSegments.add(target);
          changed = true;
          return { ...moved, segmentId: target, updatedAt: now };
        }
      }
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    // A segment the book does not hold is no evidence the translation is good again.
    const present = book.segments.some((s) => s.id === link.segmentId);
    const revived = present && !occupiedSegments.has(link.segmentId) ? revive(link, now) : link;
    if (revived !== link) occupiedSegments.add(link.segmentId);
    changed ||= revived !== link;
    return revived;
  });

  if (!changed) return analysis;
  return { ...analysis, tokenAnalysisLinks, phraseAnalysisLinks, segmentAnalysisLinks };
}
