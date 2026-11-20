import { Canon } from '@sillsdev/scripture';
import type { Book, SenseRef, TokenAnalysis } from 'interlinearizer';
import type { Collator } from 'platform-bible-utils';
import type { ApprovalsByForm } from '../types/analysis-repository';
import { isWordToken } from '../types/type-guards';
import { normalizeSurfaceForm } from './analysis-identity';
import { multiStringText } from './multi-string';

/** One place in the source text where a word form appears, carried with the verse it sits in. */
export interface ConcordanceOccurrence {
  tokenRef: string;
  book: string;
  chapter: number;
  /** First verse the occurrence's verse names, so a bridged verse reads as its opening verse. */
  verse: number;
  /** The form as written at this place. */
  surfaceText: string;
  /** Text of the verse the occurrence sits in, which its offsets index into. */
  contextText: string;
  /** Zero-based UTF-16 offset of the form within `contextText`. */
  charStart: number;
  /** Exclusive end of the form within `contextText`, in UTF-16 code units. */
  charEnd: number;
}

/** A single book's occurrences, filed under the form each one matches under. */
export interface BookConcordance {
  book: string;
  /** Stamp of the text the book was indexed from, equal across readings of unchanged text. */
  textVersion: string;
  /** Each form's occurrences in the book, in document order. */
  occurrencesByForm: ReadonlyMap<string, readonly ConcordanceOccurrence[]>;
  /** How often each of a form's spellings occurs in the book, in order of first appearance. */
  spellingCountsByForm: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** One word form of the source text with every place it occurs, before any analysis is joined in. */
export interface ConcordanceEntry {
  /** The normalized form every occurrence matches under, which identifies the entry. */
  form: string;
  /** The spelling the entry is shown by: its most frequent as-written one, ties to the earliest. */
  displayText: string;
  /** Every occurrence, in canonical document order. */
  occurrences: readonly ConcordanceOccurrence[];
  /** How many occurrences each book holds, absent books holding none. */
  countByBook: ReadonlyMap<string, number>;
}

/** How much of a form's text has been analyzed. */
export type ConcordanceStatus = 'analyzed' | 'partlyAnalyzed' | 'unanalyzed';

/** An entry as the concordance lists it, joined to the analyses and to the book in view. */
export interface ConcordanceRow {
  entry: ConcordanceEntry;
  occurrenceCountInBook: number;
  /** Occurrences whose token carries an approved analysis. */
  analyzedCount: number;
  status: ConcordanceStatus;
}

/** One analysis a form's occurrences are approved to, with how many of them it covers. */
export interface ConcordanceAnalysisTally {
  analysisId: string;
  /** Gloss in the analysis language asked for; `''` when the analysis has none there. */
  gloss: string;
  /** The lexicon sense the analysis's gloss resolves through, if any. */
  glossSenseRef?: SenseRef;
  count: number;
}

/** An occurrence's verse cut down to a line, with the form set apart from the text around it. */
export interface ContextLine {
  before: string;
  form: string;
  after: string;
  /** Whether verse text was cut from ahead of `before`. */
  clippedBefore: boolean;
  /** Whether verse text was cut from after `after`. */
  clippedAfter: boolean;
}

/**
 * How many UTF-16 code units of verse text a context line keeps on each side of the form, before
 * trimming back to the nearest word break.
 */
export const CONTEXT_RADIUS = 40;

/** Files every word of a tokenized book under the form it matches under. */
export function indexBook(book: Book): BookConcordance {
  const occurrencesByForm = new Map<string, ConcordanceOccurrence[]>();
  const spellingCountsByForm = new Map<string, Map<string, number>>();
  book.segments.forEach((segment) => {
    segment.tokens.forEach((token) => {
      if (!isWordToken(token)) return;
      const form = normalizeSurfaceForm(token.surfaceText);
      const occurrences = occurrencesByForm.get(form) ?? [];
      occurrences.push({
        tokenRef: token.ref,
        book: segment.startRef.book,
        chapter: segment.startRef.chapter,
        verse: segment.startRef.verse,
        surfaceText: token.surfaceText,
        contextText: segment.baselineText,
        charStart: token.charStart,
        charEnd: token.charEnd,
      });
      occurrencesByForm.set(form, occurrences);
      const spellingCounts = spellingCountsByForm.get(form) ?? new Map<string, number>();
      spellingCounts.set(token.surfaceText, (spellingCounts.get(token.surfaceText) ?? 0) + 1);
      spellingCountsByForm.set(form, spellingCounts);
    });
  });
  return {
    book: book.bookRef,
    textVersion: book.textVersion,
    occurrencesByForm,
    spellingCountsByForm,
  };
}

/** Picks the spelling seen most often, a tie going to the one seen first. */
function mostFrequentSpelling(counts: ReadonlyMap<string, number>): string {
  let best = '';
  let bestCount = 0;
  counts.forEach((count, spelling) => {
    if (count > bestCount) {
      best = spelling;
      bestCount = count;
    }
  });
  return best;
}

/** Merges book indexes into one entry per form across all of them, in no particular order. */
function mergeEntries(books: Iterable<BookConcordance>): ConcordanceEntry[] {
  const inCanonOrder = [...books].sort(
    (a, b) => Canon.bookIdToNumber(a.book) - Canon.bookIdToNumber(b.book),
  );
  type MergedEntry = {
    occurrences: ConcordanceOccurrence[];
    countByBook: Map<string, number>;
    spellingCounts: Map<string, number>;
  };
  const merged = new Map<string, MergedEntry>();
  const entryFor = (form: string): MergedEntry => {
    let entry = merged.get(form);
    if (!entry) {
      entry = { occurrences: [], countByBook: new Map(), spellingCounts: new Map() };
      merged.set(form, entry);
    }
    return entry;
  };
  inCanonOrder.forEach(({ book, occurrencesByForm, spellingCountsByForm }) => {
    occurrencesByForm.forEach((occurrences, form) => {
      const entry = entryFor(form);
      // Pushed one by one: a spread makes each occurrence a call argument, which a very frequent form overflows.
      occurrences.forEach((o) => entry.occurrences.push(o));
      entry.countByBook.set(book, occurrences.length);
    });
    spellingCountsByForm.forEach((counts, form) => {
      const { spellingCounts } = entryFor(form);
      counts.forEach((count, spelling) =>
        spellingCounts.set(spelling, (spellingCounts.get(spelling) ?? 0) + count),
      );
    });
  });

  return [...merged].map(
    ([form, { occurrences, countByBook, spellingCounts }]): ConcordanceEntry => ({
      form,
      displayText: mostFrequentSpelling(spellingCounts),
      occurrences,
      countByBook,
    }),
  );
}

/** Orders two entries by `collator` on their display spelling, then by form. */
function compareCollated(collator: Collator, a: ConcordanceEntry, b: ConcordanceEntry): number {
  return collator.compare(a.displayText, b.displayText) || (a.form < b.form ? -1 : 1);
}

/**
 * A concordance's entries, most-occurring first, ties ordered by `collator` on their display
 * spelling and then by form, so the order is total and stable. A slice near the top skips ordering
 * the long tail of rare forms.
 */
export class ConcordanceEntryList {
  private readonly entries: ConcordanceEntry[];

  private readonly collator: Collator;

  /** Where each run of equally frequent entries starts, ascending. */
  private readonly runStarts: number[] = [];

  /** The starts of the runs already in collated order. */
  private readonly collatedRuns = new Set<number>();

  private readonly byForm: ReadonlyMap<string, ConcordanceEntry>;

  constructor(books: Iterable<BookConcordance>, collator: Collator) {
    this.collator = collator;
    this.entries = mergeEntries(books).sort((a, b) => b.occurrences.length - a.occurrences.length);
    this.byForm = new Map(this.entries.map((entry) => [entry.form, entry]));
    this.entries.forEach((entry, index) => {
      if (index === 0 || this.entries[index - 1].occurrences.length !== entry.occurrences.length)
        this.runStarts.push(index);
    });
  }

  get length(): number {
    return this.entries.length;
  }

  /** The entry of the normalized `form`, if the text holds it. */
  find(form: string): ConcordanceEntry | undefined {
    return this.byForm.get(form);
  }

  /**
   * The entries from `start` up to, not including, `end`.
   *
   * @param start - Non-negative.
   * @param end - Non-negative. Past the length, the slice stops after the last entry.
   */
  slice(start: number, end: number): readonly ConcordanceEntry[] {
    const to = Math.min(this.entries.length, end);
    for (let run = this.runAt(start); run < this.runStarts.length; run += 1) {
      const runStart = this.runStarts[run];
      if (runStart >= to) break;
      this.collateRun(run);
    }
    return this.entries.slice(start, to);
  }

  /** The index in {@link runStarts} of the run holding entry `index`. */
  private runAt(index: number): number {
    let low = 0;
    let high = this.runStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.runStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  private collateRun(run: number): void {
    const runStart = this.runStarts[run];
    if (this.collatedRuns.has(runStart)) return;
    this.collatedRuns.add(runStart);
    const runEnd = this.runStarts[run + 1] ?? this.entries.length;
    this.entries
      .slice(runStart, runEnd)
      .sort((a, b) => compareCollated(this.collator, a, b))
      .forEach((entry, offset) => {
        this.entries[runStart + offset] = entry;
      });
  }
}

/**
 * Merges book indexes into one entry per form across all of them, whatever order the books arrive
 * in.
 *
 * @returns Entries in {@link ConcordanceEntryList}'s order.
 */
export function buildConcordanceEntries(
  books: Iterable<BookConcordance>,
  collator: Collator,
): readonly ConcordanceEntry[] {
  const list = new ConcordanceEntryList(books, collator);
  return list.slice(0, list.length);
}

/**
 * The analysis an occurrence of `entry` is approved to, `undefined` where it has none or its
 * approval names a different word, as one in a book the editor has not loaded can after its text
 * changes.
 */
export function approvedAnalysisOf(
  approved: ApprovalsByForm,
  entry: ConcordanceEntry,
  occurrence: ConcordanceOccurrence,
): string | undefined {
  return approved[entry.form]?.[occurrence.tokenRef];
}

/** Each entry's token refs, gathered once per entry. */
const tokenRefsByEntry = new WeakMap<ConcordanceEntry, ReadonlySet<string>>();

function tokenRefsOf(entry: ConcordanceEntry): ReadonlySet<string> {
  let tokenRefs = tokenRefsByEntry.get(entry);
  if (!tokenRefs) {
    tokenRefs = new Set(entry.occurrences.map(({ tokenRef }) => tokenRef));
    tokenRefsByEntry.set(entry, tokenRefs);
  }
  return tokenRefs;
}

/** How many of an entry's occurrences carry an approval, as {@link approvedAnalysisOf} finds them. */
function countApproved(approved: ApprovalsByForm, entry: ConcordanceEntry): number {
  const approvals = approved[entry.form];
  if (!approvals) return 0;
  // Walks the form's approvals rather than its occurrences: a frequent form has far fewer.
  const tokenRefs = tokenRefsOf(entry);
  return Object.keys(approvals).reduce(
    (count, tokenRef) => (tokenRefs.has(tokenRef) ? count + 1 : count),
    0,
  );
}

/** Joins each entry to the approved analyses, keeping the entries' order. */
export function deriveConcordanceRows(
  entries: readonly ConcordanceEntry[],
  approved: ApprovalsByForm,
  currentBook: string,
): readonly ConcordanceRow[] {
  return entries.map((entry) => {
    const analyzedCount = countApproved(approved, entry);
    let status: ConcordanceStatus = 'partlyAnalyzed';
    if (analyzedCount === 0) status = 'unanalyzed';
    else if (analyzedCount === entry.occurrences.length) status = 'analyzed';
    return {
      entry,
      occurrenceCountInBook: entry.countByBook.get(currentBook) ?? 0,
      analyzedCount,
      status,
    };
  });
}

/**
 * Counts how many of an entry's occurrences each approved analysis covers, glossed in
 * `analysisLanguage`.
 *
 * @returns One tally per analysis, the most-used first and ties in order of first use.
 */
export function tallyAnalyses(
  entry: ConcordanceEntry,
  approved: ApprovalsByForm,
  analysesById: ReadonlyMap<string, TokenAnalysis>,
  analysisLanguage: string,
): readonly ConcordanceAnalysisTally[] {
  const counts = new Map<string, number>();
  entry.occurrences.forEach((o) => {
    const analysisId = approvedAnalysisOf(approved, entry, o);
    if (analysisId !== undefined) counts.set(analysisId, (counts.get(analysisId) ?? 0) + 1);
  });
  return [...counts]
    .map(([analysisId, count]) => {
      const analysis = analysesById.get(analysisId);
      return {
        analysisId,
        gloss: multiStringText(analysis?.gloss, analysisLanguage),
        glossSenseRef: analysis?.glossSenseRef,
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Whether `index` falls between the halves of a surrogate pair, where a cut would split a
 * character.
 */
function splitsSurrogatePair(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cuts an occurrence's verse down to the form and up to {@link CONTEXT_RADIUS} code units either
 * side, trimming a cut that lands inside a word back to a word break where the text has one within
 * reach so no partial word shows at an edge.
 */
export function contextLine(occurrence: ConcordanceOccurrence): ContextLine {
  const { contextText: text, charStart, charEnd } = occurrence;

  let from = Math.max(0, charStart - CONTEXT_RADIUS);
  const clippedBefore = from > 0;
  if (clippedBefore && !/\s/.test(text.charAt(from - 1))) {
    const lead = text.slice(from, charStart);
    const wordBreak = lead.search(/\s/);
    if (wordBreak >= 0) from += wordBreak + 1;
    else if (splitsSurrogatePair(text, from)) from += 1;
  }

  let to = Math.min(text.length, charEnd + CONTEXT_RADIUS);
  const clippedAfter = to < text.length;
  if (clippedAfter && !/\s/.test(text.charAt(to))) {
    const tail = text.slice(charEnd, to);
    const wordBreak = tail.search(/\s\S*$/);
    if (wordBreak >= 0) to = charEnd + wordBreak;
    else if (splitsSurrogatePair(text, to)) to -= 1;
  }

  return {
    before: text.slice(from, charStart).trimStart(),
    form: text.slice(charStart, charEnd),
    after: text.slice(charEnd, to).trimEnd(),
    clippedBefore,
    clippedAfter,
  };
}
