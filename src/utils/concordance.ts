import { Canon } from '@sillsdev/scripture';
import type { Book, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import type { Collator } from 'platform-bible-utils';
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
    });
  });
  return { book: book.bookRef, textVersion: book.textVersion, occurrencesByForm };
}

/** Picks the spelling seen most often, a tie going to the one seen first. */
function mostFrequentSpelling(occurrences: readonly ConcordanceOccurrence[]): string {
  const counts = new Map<string, number>();
  occurrences.forEach((o) => counts.set(o.surfaceText, (counts.get(o.surfaceText) ?? 0) + 1));
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

/**
 * Merges book indexes into one entry per form across all of them, whatever order the books arrive
 * in.
 *
 * @returns Entries ordered most-occurring first, ties ordered by `collator` on their display
 *   spelling and then by form, so the order is total and stable.
 */
export function buildConcordanceEntries(
  books: Iterable<BookConcordance>,
  collator: Collator,
): readonly ConcordanceEntry[] {
  const inCanonOrder = [...books].sort(
    (a, b) => Canon.bookIdToNumber(a.book) - Canon.bookIdToNumber(b.book),
  );
  type MergedEntry = { occurrences: ConcordanceOccurrence[]; countByBook: Map<string, number> };
  const merged = new Map<string, MergedEntry>();
  inCanonOrder.forEach(({ book, occurrencesByForm }) => {
    occurrencesByForm.forEach((occurrences, form) => {
      const entry: MergedEntry = merged.get(form) ?? { occurrences: [], countByBook: new Map() };
      // Pushed one by one: a spread makes each occurrence a call argument, which a very frequent form overflows.
      occurrences.forEach((o) => entry.occurrences.push(o));
      entry.countByBook.set(book, occurrences.length);
      merged.set(form, entry);
    });
  });

  const entries = [...merged].map(([form, { occurrences, countByBook }]): ConcordanceEntry => ({
    form,
    displayText: mostFrequentSpelling(occurrences),
    occurrences,
    countByBook,
  }));
  return entries.sort(
    (a, b) =>
      b.occurrences.length - a.occurrences.length ||
      collator.compare(a.displayText, b.displayText) ||
      (a.form < b.form ? -1 : 1),
  );
}

/** A project's approved analyses, looked up with {@link approvedAnalysisOf}. */
export type ApprovedAnalyses = ReadonlyMap<string, string>;

function approvalKey(tokenRef: string, form: string): string {
  return `${tokenRef}\u0000${form}`;
}

/**
 * Gathers the approved links for lookup. A token approved to more than one analysis as the same
 * form — a state no write path builds — keeps the first.
 */
export function approvedAnalysisByToken(links: readonly TokenAnalysisLink[]): ApprovedAnalyses {
  const approved = new Map<string, string>();
  links.forEach((link) => {
    if (link.status !== 'approved') return;
    const key = approvalKey(link.token.tokenRef, normalizeSurfaceForm(link.token.surfaceText));
    if (!approved.has(key)) approved.set(key, link.analysisId);
  });
  return approved;
}

/**
 * The analysis an occurrence of `entry` is approved to, `undefined` where it has none or its
 * approval names a different word, as one in a book the editor has not loaded can after its text
 * changes.
 */
export function approvedAnalysisOf(
  approved: ApprovedAnalyses,
  entry: ConcordanceEntry,
  occurrence: ConcordanceOccurrence,
): string | undefined {
  return approved.get(approvalKey(occurrence.tokenRef, entry.form));
}

/** Joins each entry to the approved analyses, keeping the entries' order. */
export function deriveConcordanceRows(
  entries: readonly ConcordanceEntry[],
  approvedByToken: ApprovedAnalyses,
  currentBook: string,
): readonly ConcordanceRow[] {
  return entries.map((entry) => {
    const analyzedCount = entry.occurrences.reduce(
      (count, o) =>
        approvedAnalysisOf(approvedByToken, entry, o) === undefined ? count : count + 1,
      0,
    );
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
 * `analysisLanguage`. An analysis the approvals name but the records lack reads as unglossed.
 *
 * @returns One tally per analysis, the most-used first and ties in order of first use.
 */
export function tallyAnalyses(
  entry: ConcordanceEntry,
  approvedByToken: ApprovedAnalyses,
  analysesById: ReadonlyMap<string, TokenAnalysis>,
  analysisLanguage: string,
): readonly ConcordanceAnalysisTally[] {
  const counts = new Map<string, number>();
  entry.occurrences.forEach((o) => {
    const analysisId = approvedAnalysisOf(approvedByToken, entry, o);
    if (analysisId !== undefined) counts.set(analysisId, (counts.get(analysisId) ?? 0) + 1);
  });
  return [...counts]
    .map(([analysisId, count]) => {
      const analysis = analysesById.get(analysisId);
      return {
        analysisId,
        gloss: multiStringText(analysis?.gloss, analysisLanguage),
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
 * side, trimming each cut back to a word break where the text has one within reach so no partial
 * word shows at an edge.
 */
export function contextLine(occurrence: ConcordanceOccurrence): ContextLine {
  const { contextText: text, charStart, charEnd } = occurrence;

  let from = Math.max(0, charStart - CONTEXT_RADIUS);
  const clippedBefore = from > 0;
  if (clippedBefore) {
    const lead = text.slice(from, charStart);
    const wordBreak = lead.search(/\s/);
    if (wordBreak >= 0) from += wordBreak + 1;
    else if (splitsSurrogatePair(text, from)) from += 1;
  }

  let to = Math.min(text.length, charEnd + CONTEXT_RADIUS);
  const clippedAfter = to < text.length;
  if (clippedAfter) {
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
