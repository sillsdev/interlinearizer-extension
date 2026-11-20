import type {
  AnalysisLink,
  Book,
  PhraseAnalysisLink,
  ReadonlyBook,
  ReadonlySegment,
  ReadonlyToken,
  SegmentAnalysis,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import type { ChangeSet } from '../types/analysis-repository';
import { bookOfRef } from './analysis-book';
import { normalizeSurfaceForm } from './analysis-identity';

/**
 * Where a link's stored token snapshot now points: either the token ref it re-anchors to, with how
 * many tokens of its form the verse now holds, or nothing when its token is gone from its segment.
 */
type Anchor = { tokenRef: string; formCount: number } | undefined;

/** A book the project no longer has, as a book with no text. */
export function missingBook(bookCode: string): Book {
  return {
    id: bookCode,
    bookRef: bookCode,
    textVersion: '',
    segments: [],
    duplicateVerseIds: [],
    invalidVerseIds: [],
  };
}

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
 * @param stored - The stored forms, in document order.
 * @param current - The verse's current forms, in document order.
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
    [...storedCounts].flatMap(([form, count]) => {
      const placeable = !unpaired.has(form) && count === currentCounts.get(form);
      return placeable ? [form] : [];
    }),
  );
}

/**
 * Pairs each stored form with the index of the current form it aligns to in order, or `undefined`
 * where it has no counterpart or is too ambiguous to place.
 *
 * A form in `vanished` yields `undefined`, because the copy that the verse lost may have been a
 * stored one. It also stays out of the alignment, so that a pairing it cannot keep never costs
 * another form its own.
 */
function pairUnambiguously(
  stored: string[],
  b: string[],
  vanished: ReadonlySet<string>,
): (number | undefined)[] {
  const kept = stored.flatMap((form, index) => (vanished.has(form) ? [] : [index]));
  const keptPaired = pairInOrder(
    kept.map((index) => stored[index]),
    b,
  );
  const paired = new Array<number | undefined>(stored.length).fill(undefined);
  kept.forEach((index, keptIndex) => {
    paired[index] = keptPaired[keptIndex];
  });
  return paired;
}

/**
 * Pairs each stored form with the index of the current form it aligns to in order, or `undefined`
 * where it has no counterpart or is too ambiguous to place.
 */
function pairInOrder(a: string[], b: string[]): (number | undefined)[] {
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
 * part-deleted repeated word goes stale for review instead of landing on the wrong twin. A word
 * that moved past others places when its form is unambiguous, so aligning the result again changes
 * nothing. A position `live` does not mark counts toward whether its form is ambiguous but never
 * dislodges a live one from its own ref, its ref possibly predating an edit.
 *
 * A form whose positions all share one defined `kin` has interchangeable copies. When the verse
 * holds fewer of that form than were stored, its remaining tokens still place. Only the extra
 * positions yield `undefined`, because it makes no difference which copy an edit removed.
 *
 * A form in `vanished` places only where a position's own ref still names it. The verse lost a copy
 * of that form, and the text cannot say whether a stored copy was the one lost.
 */
function alignForms(
  stored: string[],
  storedRefs: string[],
  tokens: ReadonlyToken[],
  live: boolean[],
  kin: (string | undefined)[],
  vanished: ReadonlySet<string>,
): (string | undefined)[] {
  const forms = stored.map(normalizeSurfaceForm);
  const kinByForm = new Map<string, Set<string | undefined>>();
  forms.forEach((form, index) => {
    const formKin = kinByForm.get(form) ?? new Set<string | undefined>();
    formKin.add(kin[index]);
    kinByForm.set(form, formKin);
  });
  const interchangeable = new Set(
    [...kinByForm].flatMap(([form, formKin]) =>
      formKin.size === 1 && !formKin.has(undefined) ? [form] : [],
    ),
  );
  const currentCounts = countByValue(tokens.map((t) => normalizeSurfaceForm(t.surfaceText)));
  const keptCounts = new Map<string, number>();
  const kept = forms.flatMap((form, index) => {
    const count = (keptCounts.get(form) ?? 0) + 1;
    keptCounts.set(form, count);
    return interchangeable.has(form) && count > (currentCounts.get(form) ?? 0) ? [] : [index];
  });

  const keptAnchors = alignKept(
    kept.map((index) => stored[index]),
    kept.map((index) => storedRefs[index]),
    tokens,
    kept.map((index) => live[index]),
    vanished,
  );
  const anchors = new Array<string | undefined>(stored.length).fill(undefined);
  kept.forEach((index, keptIndex) => {
    anchors[index] = keptAnchors[keptIndex];
  });
  return anchors;
}

/**
 * Gives each stored form the token ref it should carry, given that no interchangeable form has more
 * stored copies than the verse has tokens of it. A form in `vanished` places only on its own ref.
 */
function alignKept(
  stored: string[],
  storedRefs: string[],
  tokens: ReadonlyToken[],
  live: boolean[],
  vanished: ReadonlySet<string>,
): (string | undefined)[] {
  const a = stored.map(normalizeSurfaceForm);
  const b = tokens.map((t) => normalizeSurfaceForm(t.surfaceText));

  // A stored position whose own ref still names a token of its form has not moved, whatever the
  // alignment would pair it with — the ref is better evidence of which twin a gloss meant. Not so
  // for a form that lost an occurrence, where a surviving twin may have shifted onto the ref, nor
  // for one whose settled and aligned occurrences would cross, where an earlier twin has. Against a
  // live position only live ones testify.
  const currentCounts = countByValue(b);
  const overcounted = (forms: string[]) =>
    new Set(
      [...countByValue(forms)]
        .filter(([form, count]) => count > (currentCounts.get(form) ?? 0))
        .map(([form]) => form),
    );
  const overcountedLive = overcounted(a.filter((_, index) => live[index]));
  const overcountedAll = overcounted(a);
  const unsettledForms = new Set<string>();
  const unsettled = (index: number) =>
    unsettledForms.has(a[index]) || (live[index] ? overcountedLive : overcountedAll).has(a[index]);
  const indexByRef = new Map(tokens.map((token, index) => [token.ref, index]));
  let placed = new Map<number, number>();
  let paired: (number | undefined)[];
  // Pairing keeps order, so a word moved past others pairs only once they are withheld as placed.
  // Ends: each round places more or unsettles another form.
  for (;;) {
    paired = pairAroundSettled(a, b, storedRefs, indexByRef, unsettled, placed, vanished);
    const crossed = formsOutOfOrder(a, paired, live);
    if (crossed.size > 0) {
      crossed.forEach((form) => unsettledForms.add(form));
      placed = new Map([...placed].filter(([index]) => !crossed.has(a[index])));
    } else {
      const next = new Map(
        paired.flatMap((tokenIndex, index) =>
          tokenIndex === undefined ? [] : [[index, tokenIndex] as const],
        ),
      );
      if (next.size === placed.size) break;
      placed = next;
    }
  }
  return paired.map((tokenIndex) =>
    tokenIndex === undefined ? undefined : tokens[tokenIndex].ref,
  );
}

/**
 * Pairs each stored form with a token index: the one `placed` already gives it, else the token its
 * own ref names where that is still of its form and `unsettled` allows, otherwise by aligning what
 * is left in order, or `undefined` where none places it. The alignment places no form in
 * `vanished`.
 */
function pairAroundSettled(
  a: string[],
  b: string[],
  storedRefs: string[],
  indexByRef: Map<string, number>,
  unsettled: (index: number) => boolean,
  placed: Map<number, number>,
  vanished: ReadonlySet<string>,
): (number | undefined)[] {
  const settled = a.map((form, index) => {
    const placedIndex = placed.get(index);
    if (placedIndex !== undefined) return placedIndex;
    if (unsettled(index)) return undefined;
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
    vanished,
  );

  const paired = [...settled];
  openStored.forEach((storedIndex, openIndex) => {
    const openTokenIndex = openPaired[openIndex];
    if (openTokenIndex !== undefined) paired[storedIndex] = openTokens[openTokenIndex];
  });
  return paired;
}

/**
 * The forms whose occurrences, taken in stored order, pair to tokens out of document order, judged
 * only against the live occurrences `live` marks.
 */
function formsOutOfOrder(
  forms: string[],
  paired: (number | undefined)[],
  live: boolean[],
): Set<string> {
  const lastTokenIndex = new Map<string, number>();
  const crossed = new Set<string>();
  forms.forEach((form, index) => {
    const tokenIndex = paired[index];
    if (tokenIndex === undefined) return;
    if (tokenIndex < (lastTokenIndex.get(form) ?? -1)) crossed.add(form);
    if (live[index]) lastTokenIndex.set(form, tokenIndex);
  });
  return crossed;
}

/**
 * Groups the book's tokens by the verse each one's own ref names, in document order — so a custom
 * segmentation that merges several verses into one segment still yields each verse separately.
 *
 * A verse the book holds but that carries no tokens gets an empty group rather than no entry, so
 * emptying a verse's text orphans its analyses instead of leaving them pointing at nothing.
 */
function tokensByVerse(book: ReadonlyBook): Map<string, ReadonlyToken[]> {
  const byVerse = new Map<string, ReadonlyToken[]>();
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
 * word at a ref each get their own answer. Places `deferred` only on tokens `snapshots` leave
 * unclaimed, so none of them can displace one of `snapshots`. The snapshots whose keys `isLive`
 * accepts hold their token ahead of the rest of `snapshots`, all of them when it is omitted.
 * Snapshots of one form are interchangeable copies when `kinOf` maps all their keys to one value. A
 * key that `kinOf` maps to `undefined` has no kin.
 */
function buildAnchorMap(
  snapshots: TokenSnapshot[],
  book: ReadonlyBook,
  deferred: TokenSnapshot[] = [],
  isLive: (key: string) => boolean = () => true,
  kinOf: (key: string) => string | undefined = () => undefined,
): Map<string, Anchor> {
  const byVerse = tokensByVerse(book);
  const anchorMap = new Map<string, Anchor>();
  anchorByVerse(snapshots, byVerse, new Set(), book.bookRef, anchorMap, isLive, kinOf);
  if (deferred.length === 0) return anchorMap;

  const claimed = new Set(
    [...anchorMap.values()].flatMap((anchor) => (anchor ? [anchor.tokenRef] : [])),
  );
  anchorByVerse(
    deferred.filter((snapshot) => !anchorMap.has(snapshotKey(snapshot))),
    byVerse,
    claimed,
    book.bookRef,
    anchorMap,
    () => true,
    () => undefined,
  );
  return anchorMap;
}

/**
 * Records in `anchorMap` where each snapshot now belongs among its verse's tokens that `claimed`
 * leaves out. A form's count still covers the claimed tokens. That whole-verse count judges whether
 * a copy vanished. Each anchor records it too.
 */
function anchorByVerse(
  snapshots: TokenSnapshot[],
  byVerse: Map<string, ReadonlyToken[]>,
  claimed: ReadonlySet<string>,
  bookRef: string,
  anchorMap: Map<string, Anchor>,
  isLive: (key: string) => boolean,
  kinOf: (key: string) => string | undefined,
): void {
  // Deduplicated: a token named by several links contributes a snapshot from each, and aligning the
  // same word twice would consume two current tokens and orphan one copy. Duplicates keep the
  // largest count any of them recorded, so a link written without one hides no vanished copy.
  const uniqueSnapshots = new Map<string, TokenSnapshot>();
  snapshots.forEach((snapshot) => {
    const key = snapshotKey(snapshot);
    const kept = uniqueSnapshots.get(key)?.formCount;
    const formCount =
      kept === undefined || snapshot.formCount === undefined
        ? (kept ?? snapshot.formCount)
        : Math.max(kept, snapshot.formCount);
    uniqueSnapshots.set(key, formCount === undefined ? snapshot : { ...snapshot, formCount });
  });

  // Keyed by the verse's token list rather than its ref so the alignment below needs no second
  // lookup, which would have to answer for a verse this grouping already dropped.
  const grouped = new Map<ReadonlyToken[], TokenSnapshot[]>();
  uniqueSnapshots.forEach((snapshot, key) => {
    const tokens = byVerse.get(verseOfTokenRef(snapshot.tokenRef));
    if (!tokens) {
      // A verse gone from its own book took its tokens with it.
      if (bookOfRef(snapshot.tokenRef) === bookRef) anchorMap.set(key, undefined);
      return;
    }
    const group = grouped.get(tokens);
    if (group) group.push(snapshot);
    else grouped.set(tokens, [snapshot]);
  });

  grouped.forEach((group, verseTokens) => {
    const ordered = [...group].sort(
      (x, y) => offsetOfTokenRef(x.tokenRef) - offsetOfTokenRef(y.tokenRef),
    );
    const currentCounts = countByValue(verseTokens.map((t) => normalizeSurfaceForm(t.surfaceText)));
    const refs = alignForms(
      ordered.map((s) => s.surfaceText),
      ordered.map((s) => s.tokenRef),
      verseTokens.filter((t) => !claimed.has(t.ref)),
      ordered.map((s) => isLive(snapshotKey(s))),
      ordered.map((s) => kinOf(snapshotKey(s))),
      vanishedForms(ordered, currentCounts),
    );
    ordered.forEach((snapshot, index) => {
      const tokenRef = refs[index];
      const formCount = currentCounts.get(normalizeSurfaceForm(snapshot.surfaceText)) ?? 0;
      anchorMap.set(
        snapshotKey(snapshot),
        tokenRef === undefined ? undefined : { tokenRef, formCount },
      );
    });
  });
}

/**
 * The normalized forms whose verse held copies that `snapshots` do not store, and now holds fewer
 * copies than it did. What the verse held is the largest {@link TokenSnapshot.formCount} among the
 * form's snapshots.
 */
function vanishedForms(
  snapshots: TokenSnapshot[],
  currentCounts: Map<string, number>,
): Set<string> {
  const storedCounts = countByValue(snapshots.map((s) => normalizeSurfaceForm(s.surfaceText)));
  const recordedCounts = new Map<string, number>();
  snapshots.forEach(({ surfaceText, formCount }) => {
    if (formCount === undefined) return;
    const form = normalizeSurfaceForm(surfaceText);
    recordedCounts.set(form, Math.max(formCount, recordedCounts.get(form) ?? 0));
  });
  return new Set(
    [...storedCounts].flatMap(([form, stored]) => {
      const recorded = recordedCounts.get(form);
      return recorded !== undefined &&
        recorded > stored &&
        /* v8 ignore next -- a form with no tokens left has nothing to place on either way */
        recorded > (currentCounts.get(form) ?? 0)
        ? [form]
        : [];
    }),
  );
}

/** Returns the character offset within the verse that a token ref names. */
function offsetOfTokenRef(tokenRef: string): number {
  return Number(tokenRef.slice(tokenRef.lastIndexOf(':') + 1));
}

/**
 * Applies the re-anchor map to one snapshot. A placed snapshot that carries a
 * {@link TokenSnapshot.formCount} takes the verse's current count when `recounts` is set.
 *
 * @returns The snapshot to keep, `changed` when it took a new ref or count, `orphaned` when the map
 *   could not place it — its token is gone, or its form is too ambiguous to place — and `placed`
 *   when the map did find it a token, whether or not that moved it. A snapshot outside the book
 *   being re-anchored comes back untouched, neither changed nor orphaned nor placed.
 */
function reanchorSnapshot(
  snapshot: TokenSnapshot,
  anchorMap: Map<string, Anchor>,
  recounts = false,
): { snapshot: TokenSnapshot; changed: boolean; orphaned: boolean; placed: boolean } {
  const key = snapshotKey(snapshot);
  if (!anchorMap.has(key)) {
    return { snapshot, changed: false, orphaned: false, placed: false };
  }
  const anchor = anchorMap.get(key);
  if (anchor === undefined) return { snapshot, changed: false, orphaned: true, placed: false };
  const formCount =
    recounts && snapshot.formCount !== undefined ? anchor.formCount : snapshot.formCount;
  if (anchor.tokenRef === snapshot.tokenRef && formCount === snapshot.formCount)
    return { snapshot, changed: false, orphaned: false, placed: true };
  return {
    snapshot: {
      ...snapshot,
      tokenRef: anchor.tokenRef,
      ...(formCount !== undefined && { formCount }),
    },
    changed: true,
    orphaned: false,
    placed: true,
  };
}

/**
 * Re-points each snapshot at the token it now names in `book`, returning a snapshot that cannot be
 * placed, or that names a verse the book does not hold, as it was.
 */
export function reanchorSnapshots(snapshots: TokenSnapshot[], book: ReadonlyBook): TokenSnapshot[] {
  const anchorMap = buildAnchorMap(snapshots, book);
  return snapshots.map((snapshot) => reanchorSnapshot(snapshot, anchorMap).snapshot);
}

/**
 * Records a {@link TokenSnapshot.formCount} on each snapshot lacking one, in the token and phrase
 * links that `changes` put. A snapshot stays uncounted when `bookOf` holds no text for its verse,
 * or when its ref names a different word there.
 *
 * @returns `changes` itself when no snapshot took a count.
 */
export function withFormCounts(
  changes: ChangeSet,
  bookOf: (bookId: string) => ReadonlyBook | undefined,
): ChangeSet {
  const versesByBook = new Map<string, Map<string, ReadonlyToken[]> | undefined>();
  const versesOf = (bookId: string) => {
    if (!versesByBook.has(bookId)) {
      const book = bookOf(bookId);
      versesByBook.set(bookId, book && tokensByVerse(book));
    }
    return versesByBook.get(bookId);
  };
  let counted = false;
  const count = (snapshot: TokenSnapshot): TokenSnapshot => {
    if (snapshot.formCount !== undefined) return snapshot;
    const tokens = versesOf(bookOfRef(snapshot.tokenRef))?.get(verseOfTokenRef(snapshot.tokenRef));
    const form = normalizeSurfaceForm(snapshot.surfaceText);
    const token = tokens?.find(({ ref }) => ref === snapshot.tokenRef);
    if (!tokens || !token || normalizeSurfaceForm(token.surfaceText) !== form) return snapshot;
    counted = true;
    const formCount = tokens.filter((t) => normalizeSurfaceForm(t.surfaceText) === form).length;
    return { ...snapshot, formCount };
  };
  const { tokenAnalysisLinks, phraseAnalysisLinks } = changes;
  const counts: ChangeSet = {
    ...changes,
    ...(tokenAnalysisLinks && {
      tokenAnalysisLinks: {
        ...tokenAnalysisLinks,
        puts: tokenAnalysisLinks.puts.map((link) => ({ ...link, token: count(link.token) })),
      },
    }),
    ...(phraseAnalysisLinks && {
      phraseAnalysisLinks: {
        ...phraseAnalysisLinks,
        puts: phraseAnalysisLinks.puts.map((link) => ({ ...link, tokens: link.tokens.map(count) })),
      },
    }),
  };
  return counted ? counts : changes;
}

/**
 * Builds the check for whether a segment link's stored baseline has fallen out of step with the
 * segment it names. A segment of the loaded book's own that it no longer holds has drifted; one
 * from another book counts as undrifted, the loaded book having no evidence either way.
 *
 * A free translation is a claim about the whole segment, so it drifts as soon as the segment says
 * anything other than what it was written over — whether the words themselves changed or a boundary
 * moved to cover different ones.
 */
function baselineDriftCheck(
  segmentsById: Map<string, ReadonlySegment>,
  segmentAnalyses: SegmentAnalysis[],
  bookRef: string,
): (segmentId: string, analysisId: string) => boolean {
  const surfaceByAnalysis = new Map(segmentAnalyses.map((a) => [a.id, a.surfaceText]));
  return (segmentId, analysisId) => {
    const segment = segmentsById.get(segmentId);
    if (!segment) return bookOfRef(segmentId) === bookRef;
    const surfaceText = surfaceByAnalysis.get(analysisId);
    /* v8 ignore next -- a link always accompanies the analysis payload it names */
    if (surfaceText === undefined) return false;
    return segment.baselineText !== surfaceText;
  };
}

/**
 * Builds the lookup for the heading a translation written for a heading now names, presuming a
 * same-marker heading added or removed in its verse re-keyed it: the one heading of that verse and
 * marker reading exactly as the translation's baseline, or `undefined` for none or several.
 */
function movedHeadingLookup(
  book: ReadonlyBook,
  segmentAnalyses: SegmentAnalysis[],
): (segmentId: string, analysisId: string) => string | undefined {
  // Strips the ordinal a heading id takes when an earlier heading of its verse and marker took the id.
  const unnumbered = (segmentId: string) => segmentId.replace(/#\d+$/, '');
  const headingsById = new Map<string, ReadonlySegment[]>();
  book.segments.forEach((segment) => {
    if (!segment.heading) return;
    const id = unnumbered(segment.id);
    headingsById.set(id, [...(headingsById.get(id) ?? []), segment]);
  });
  const surfaceByAnalysis = new Map(segmentAnalyses.map((a) => [a.id, a.surfaceText]));
  return (segmentId, analysisId) => {
    const surfaceText = surfaceByAnalysis.get(analysisId);
    const matches = (headingsById.get(unnumbered(segmentId)) ?? []).filter(
      (heading) => heading.baselineText === surfaceText,
    );
    return matches.length === 1 ? matches[0].id : undefined;
  };
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

/** Bounds the passes one re-anchoring repeats while each still changes something. */
const MAX_REANCHOR_PASSES = 8;

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
 * between identical words its approved, candidate, and stale links do not cover in full, whatever
 * rejected links cover the rest. A snapshot with no counterpart keeps the ref it was written
 * against and flips an approval to `'stale'`, so the record survives for review rather than being
 * silently dropped or silently misattached. Future work should resist growing this into a general
 * diff — the cost of a wrong match is a gloss on the wrong word, which is worse than an honest
 * `'stale'`. A phrase whose tokens fall in more than one of `book`'s segments is staled the same
 * way, since no phrase may span a segment boundary.
 *
 * Where every copy of a word carries the same links and no phrase names any of them, the copies are
 * interchangeable. An edit that removes some of them strands only as many copies as it removed. The
 * other copies keep their status.
 *
 * A verse may hold fewer copies of a word than its snapshots' {@link TokenSnapshot.formCount}
 * records, where some of the recorded copies were unlinked. The edit may then have removed a linked
 * copy or an unlinked one. A linked copy keeps its place only while its own ref still names the
 * word. A snapshot that the pass places takes the verse's current count, if it carries a count.
 *
 * Only approvals are staled and only stale links revived, so the pass gives back exactly what it
 * takes: a stale link whose snapshot places again returns to `'approved'`, restoring an analysis an
 * upstream edit stranded, while a verdict someone recorded — a rejection, a candidate — keeps its
 * status through an edit and its undoing, though it moves with its word. A link stays stale where
 * reviving it would give one token, one phrase's token, or one segment, a second occupying link, so
 * of two stale links contending for one target only the earlier in the list revives. Run again over
 * its own result and the splits as it left them, the pass changes nothing.
 *
 * A segment analysis has no offsets to heal, so it is checked rather than re-anchored: a segment
 * whose text differs at all from the stored baseline — an edit to the words or a boundary moved to
 * cover different ones — stales its approval, a free translation of since-changed text no longer
 * being a claim about what the segment says, and returns to `'approved'` once the segment reads
 * exactly that way again. A translation of a split piece re-keyed by an edit earlier in its verse
 * follows that piece's boundary among `storedSplits`, the splits as stored before `book`
 * re-anchored them, staying stale there until the piece reads as before. A heading's translation
 * re-keyed by a heading of its marker added or removed ahead of it in its verse follows the one
 * heading of that verse and marker reading exactly as it did. Every link the pass rewrites takes
 * `now` as its `updatedAt`.
 *
 * @returns The healed analysis, or `analysis` itself when nothing moved, so the caller finds no
 *   changes to apply for an unchanged book.
 */
export function reanchorAnalysisToBook(
  analysis: TextAnalysis,
  book: ReadonlyBook,
  now: string,
  storedSplits: TokenSnapshot[] = [],
): TextAnalysis {
  const settledSplits = reanchorSnapshots(storedSplits, book);
  let previous = analysis;
  let healed = reanchorOnce(analysis, book, now, storedSplits);
  // Staling an approval can free what it held ambiguous, which only a further pass places.
  for (let passes = 1; healed !== previous && passes < MAX_REANCHOR_PASSES; passes += 1) {
    previous = healed;
    healed = reanchorOnce(healed, book, now, settledSplits);
  }
  return healed;
}

/** Makes one pass of {@link reanchorAnalysisToBook}, which a further pass may take further. */
function reanchorOnce(
  analysis: TextAnalysis,
  book: ReadonlyBook,
  now: string,
  storedSplits: TokenSnapshot[],
): TextAnalysis {
  const inBook = (tokenRef: string) => bookOfRef(tokenRef) === book.bookRef;

  const splitAnchorMap = buildAnchorMap(storedSplits, book);
  const movedSplits = new Map<string, string>();
  storedSplits.forEach((start) => {
    const result = reanchorSnapshot(start, splitAnchorMap);
    if (result.changed) movedSplits.set(start.tokenRef, result.snapshot.tokenRef);
  });

  const snapshotsWhere = (included: (link: AnalysisLink) => boolean): TokenSnapshot[] =>
    [
      ...analysis.tokenAnalysisLinks.filter(included).map((l) => l.token),
      ...analysis.phraseAnalysisLinks.filter(included).flatMap((l) => l.tokens),
    ].filter((s) => inBook(s.tokenRef));

  // A stale link weighs in beside the live ones, so staling an approval leaves the next pass the
  // same evidence; the rest place only on tokens those leave unclaimed, displacing none.
  const weighs = (link: AnalysisLink) => occupies(link) || link.status === 'stale';
  const liveKeys = new Set(snapshotsWhere(occupies).map(snapshotKey));
  // Copies of a word are kin when the links naming them match exactly. It then makes no difference
  // which kin copy an edit removes. A copy in a phrase has no kin, because the phrase ties it to
  // its place.
  const linksByKey = new Map<string, string[]>();
  analysis.tokenAnalysisLinks.forEach((link) => {
    const key = snapshotKey(link.token);
    const signature = JSON.stringify([link.analysisId, link.status, link.confidence]);
    linksByKey.set(key, [...(linksByKey.get(key) ?? []), signature]);
  });
  const kinByKey = new Map(
    [...linksByKey].map(([key, signatures]) => [key, signatures.sort().join('\n')]),
  );
  analysis.phraseAnalysisLinks.forEach((link) =>
    link.tokens.forEach((token) => kinByKey.delete(snapshotKey(token))),
  );
  const anchorMap = buildAnchorMap(
    snapshotsWhere(weighs),
    book,
    snapshotsWhere((link) => !weighs(link)),
    (key) => liveKeys.has(key),
    (key) => kinByKey.get(key),
  );
  let changed = false;

  // Where each occupying link ends up, not where it started, so reviving a stale one cannot make a
  // token's second. A link this pass stales occupies nothing, having given its token up.
  const occupiedElsewhere = new Set(
    analysis.tokenAnalysisLinks
      .filter(occupies)
      .map((l) => reanchorSnapshot(l.token, anchorMap, true))
      .filter((r) => !r.orphaned)
      .map((r) => r.snapshot.tokenRef),
  );

  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.map((link) => {
    const result = reanchorSnapshot(link.token, anchorMap, true);
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

  const segmentIdByTokenRef = new Map(
    book.segments.flatMap((s) => s.tokens.map((t) => [t.ref, s.id] as const)),
  );
  /** Whether a phrase has lost a token or spans segments. */
  const isStranded = (results: readonly ReturnType<typeof reanchorSnapshot>[]) =>
    results.some((r) => r.orphaned) ||
    new Set(results.map((r) => segmentIdByTokenRef.get(r.snapshot.tokenRef))).size > 1;

  // Which tokens an occupying phrase holds, so reviving a stale one cannot give a token a second
  // approved phrase. A token's own parse is no obstacle — only another phrase is.
  const phraseOccupiedElsewhere = new Set(
    analysis.phraseAnalysisLinks
      .filter(occupies)
      .map((l) => l.tokens.map((token) => reanchorSnapshot(token, anchorMap, true)))
      .filter((results) => !isStranded(results))
      .flatMap((results) => results.map((r) => r.snapshot.tokenRef)),
  );

  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.map((link) => {
    const results = link.tokens.map((token) => reanchorSnapshot(token, anchorMap, true));
    let updated: PhraseAnalysisLink;
    if (isStranded(results)) {
      // Still moves the tokens that did place, so one it shares with another link stays one word.
      updated = markStale(link, now);
    } else {
      updated =
        results.every((r) => r.placed) &&
        !results.some((r) => phraseOccupiedElsewhere.has(r.snapshot.tokenRef))
          ? revive(link, now)
          : link;
      // So two stale phrases over a shared token cannot both come back.
      if (updated !== link)
        results.forEach((r) => phraseOccupiedElsewhere.add(r.snapshot.tokenRef));
    }
    if (!results.some((r) => r.changed)) {
      changed ||= updated !== link;
      return updated;
    }
    changed = true;
    return { ...updated, tokens: results.map((r) => r.snapshot), updatedAt: now };
  });

  const segmentsById = new Map(book.segments.map((s) => [s.id, s]));
  const hasDriftedBaseline = baselineDriftCheck(
    segmentsById,
    analysis.segmentAnalyses,
    book.bookRef,
  );
  const movedHeadingOf = movedHeadingLookup(book, analysis.segmentAnalyses);

  // Where an occupying translation stays, so neither reviving a stale one nor moving one onto the
  // segment can give it a second. One leaving with its split holds nothing, even if an identical
  // piece has shifted onto its old id.
  const occupiedSegments = new Set(
    analysis.segmentAnalysisLinks
      .filter(occupies)
      .filter(
        (l) => !movedSplits.has(l.segmentId) && !hasDriftedBaseline(l.segmentId, l.analysisId),
      )
      .map((l) => l.segmentId),
  );

  const segmentAnalysisLinks = analysis.segmentAnalysisLinks.map((link) => {
    // Moves even while stale: a later pass has no record of a split's move, and a heading's
    // translation left behind would be reviewed on whichever heading took its id.
    const target =
      movedSplits.get(link.segmentId) ??
      (hasDriftedBaseline(link.segmentId, link.analysisId)
        ? movedHeadingOf(link.segmentId, link.analysisId)
        : undefined);
    if (target !== undefined) {
      const fits = !occupiedSegments.has(target) && !hasDriftedBaseline(target, link.analysisId);
      const moved = fits ? revive(link, now) : markStale(link, now);
      if (!occupies(moved) || fits) {
        if (occupies(moved)) occupiedSegments.add(target);
        changed = true;
        return { ...moved, segmentId: target, updatedAt: now };
      }
    }
    if (hasDriftedBaseline(link.segmentId, link.analysisId)) {
      const stale = markStale(link, now);
      changed ||= stale !== link;
      return stale;
    }
    // A segment the book does not hold is no evidence the translation is good again.
    const present = segmentsById.has(link.segmentId);
    const revived = present && !occupiedSegments.has(link.segmentId) ? revive(link, now) : link;
    if (revived !== link) occupiedSegments.add(link.segmentId);
    changed ||= revived !== link;
    return revived;
  });

  if (!changed) return analysis;
  return { ...analysis, tokenAnalysisLinks, phraseAnalysisLinks, segmentAnalysisLinks };
}
