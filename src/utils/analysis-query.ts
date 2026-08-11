import { Canon } from '@sillsdev/scripture';
import type {
  Confidence,
  MorphemeAnalysis,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { bookOfRef } from './analysis-book';
import { foldForSearch } from './search-fold';
import { firstVerseNumber } from './verse-ref';

/** The values every row is derived relative to. */
export interface CatalogScope {
  /** BCP 47 tag whose gloss each row displays. */
  analysisLanguage: string;
  /** Book code the per-book usage count is taken against. */
  currentBook: string;
}

/** One distinct token analysis, with the usage data the catalog lists it by. */
export interface CatalogRow {
  analysisId: string;
  surfaceText: string;
  /** Gloss in the scope's analysis language; `''` when the analysis has none. */
  gloss: string;
  morphemes: readonly MorphemeAnalysis[];
  pos?: string;
  /** Morphosyntactic features, each feature name mapped to the analysis's value for it. */
  features?: Readonly<Record<string, string>>;
  confidence?: Confidence;
  /** Places in the whole draft where the analysis is applied. */
  usageCount: number;
  /** Places in the scope's book where the analysis is applied. */
  usageCountInBook: number;
  /** Every place the analysis is applied, in document order. */
  usages: readonly CatalogUsage[];
  /** Books the analysis is used in. */
  books: ReadonlySet<string>;
  /** Everything a search query is matched against, folded. */
  searchText: string;
}

/** How the rows are ordered. */
export type CatalogSort =
  'usageCount' | 'usageCountInBook' | 'surfaceText' | 'gloss' | 'firstUsage';

/**
 * Which rows are kept. An absent filter is inactive, as is an empty selection. A selection of a
 * field an analysis holds one value of accepts `undefined` as the choice for rows carrying no value
 * for it, so each such field can be filtered for what it lacks as well as for what it carries.
 */
export interface CatalogFilters {
  /** Keeps rows used in at least one of these books. */
  books?: readonly string[];
  /** Keeps rows carrying one of these parts of speech. */
  pos?: readonly (string | undefined)[];
  /** Keeps rows carrying one of these confidence levels. */
  confidence?: readonly (Confidence | undefined)[];
  /** Keeps rows matching every named feature, each against its own accepted values. */
  features?: Readonly<Record<string, readonly (string | undefined)[]>>;
  /** Keeps only rows nothing uses. */
  zeroUsages?: boolean;
  /** Keeps only rows with no gloss in the scope's analysis language. */
  missingGloss?: boolean;
  /** Keeps rows according to whether they carry a morpheme breakdown. */
  morphemes?: 'has' | 'lacks';
}

/** How the caller narrows and orders the rows. */
export interface CatalogQuery {
  /**
   * Matched as a plain substring against each row's folded text, ignoring surrounding whitespace;
   * `''` matches everything.
   */
  search: string;
  sort: CatalogSort;
  filters: CatalogFilters;
  /** Collates surface forms, so ordering follows the source language rather than code points. */
  surfaceCollator: Intl.Collator;
  /** Collates glosses, so ordering follows the analysis language rather than code points. */
  glossCollator: Intl.Collator;
}

/**
 * One place in the text where an analysis is applied, read off the token ref alone — the catalog
 * never resolves the token itself.
 */
export interface CatalogUsage {
  tokenRef: string;
  book: string;
  chapter: number;
  verse: number;
  /** Zero-based UTF-16 offset of the token within its segment's baseline text. */
  charStart: number;
}

/**
 * Reads the location a token ref names. A ref is a verse SID plus the token's character offset
 * (`"GEN 1:1:0"`), so the whole location is recoverable from the string. The SID's verse portion is
 * verbatim USJ, so a bridged verse resolves to the first verse it names.
 */
function parseUsage(tokenRef: string): CatalogUsage {
  const [chapterPart, versePart, charPart] = tokenRef.slice(tokenRef.indexOf(' ') + 1).split(':');
  return {
    tokenRef,
    book: bookOfRef(tokenRef),
    chapter: Number(chapterPart),
    /* v8 ignore next -- a sid whose verse portion starts with no digit cannot reach a token ref */
    verse: firstVerseNumber(versePart) ?? 0,
    charStart: Number(charPart),
  };
}

/** Orders two usages by document position, taking books in canonical rather than alphabetical order. */
function compareDocumentOrder(a: CatalogUsage, b: CatalogUsage): number {
  return (
    Canon.bookIdToNumber(a.book) - Canon.bookIdToNumber(b.book) ||
    a.chapter - b.chapter ||
    a.verse - b.verse ||
    a.charStart - b.charStart
  );
}

/**
 * Files each analysis's usages under its id, each list in document order.
 *
 * Only an approved link is a usage: a rejected link is by definition not a place the analysis is
 * applied. Counting approvals alone leaves a row's count equal to the analysis's frequency in the
 * suggestion pool, which counts the tokens an approval sits on rather than the approvals themselves
 * — the two agree for as long as a token carries at most one approved link, as the data model
 * requires.
 */
function groupUsagesByAnalysisId(
  links: readonly TokenAnalysisLink[],
): ReadonlyMap<string, CatalogUsage[]> {
  const byId = links.reduce((acc, l) => {
    if (l.status !== 'approved') return acc;
    const usages = acc.get(l.analysisId);
    const usage = parseUsage(l.token.tokenRef);
    if (usages) usages.push(usage);
    else acc.set(l.analysisId, [usage]);
    return acc;
  }, new Map<string, CatalogUsage[]>());
  byId.forEach((usages) => usages.sort(compareDocumentOrder));
  return byId;
}

/**
 * Assembles the folded text a search matches an analysis by, drawing on its forms and on every
 * gloss it carries whatever the language, so a gloss stays findable in a language the project does
 * not declare. No match spans two of the assembled fields.
 */
function buildSearchText(ta: TokenAnalysis): string {
  const morphemeText = (ta.morphemes ?? []).flatMap((m) => [
    m.form,
    ...Object.values(m.gloss ?? {}),
  ]);
  return foldForSearch(
    [ta.surfaceText, ...Object.values(ta.gloss ?? {}), ...morphemeText].join('\n'),
  );
}

/**
 * Derives one row per distinct token analysis. Pure in the analysis records: nothing here reads the
 * tokenized text, so the catalog reports what was recorded rather than whether the text a usage
 * points at still says the same thing.
 */
export function buildCatalogRows(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
): readonly CatalogRow[] {
  const usagesByAnalysisId = groupUsagesByAnalysisId(analysis.tokenAnalysisLinks);

  return analysis.tokenAnalyses.map((ta) => {
    const usages = usagesByAnalysisId.get(ta.id) ?? [];
    return {
      analysisId: ta.id,
      surfaceText: ta.surfaceText,
      gloss: ta.gloss?.[scope.analysisLanguage] ?? '',
      morphemes: ta.morphemes ?? [],
      pos: ta.pos,
      features: ta.features,
      confidence: ta.confidence,
      usageCount: usages.length,
      usageCountInBook: usages.filter((u) => u.book === scope.currentBook).length,
      usages,
      books: new Set(usages.map((u) => u.book)),
      searchText: buildSearchText(ta),
    };
  });
}

/** Orders two rows by where each is first applied, an unused analysis coming after every used one. */
function compareFirstUsage(a: CatalogRow, b: CatalogRow): number {
  const [firstA] = a.usages;
  const [firstB] = b.usages;
  if (!firstA) return firstB ? 1 : 0;
  if (!firstB) return -1;
  return compareDocumentOrder(firstA, firstB);
}

/**
 * Orders two rows by gloss, an analysis with none in the scope's language coming after every one
 * that has one.
 */
function compareGloss(a: CatalogRow, b: CatalogRow, glossCollator: Intl.Collator): number {
  if (!a.gloss) return b.gloss ? 1 : 0;
  if (!b.gloss) return -1;
  return glossCollator.compare(a.gloss, b.gloss);
}

/**
 * The choices the rows offer for each closed-vocabulary field, each field's list offered as a
 * filter.
 *
 * For a field an analysis holds one value of, carrying no value is a choice of its own, listed as
 * `undefined` after the values, so a field a single row is tagged with is still offered — that
 * choice narrows the list to the tagged row, and its counterpart answers which analyses are still
 * missing the field. A facet is absent only when the rows are all in one of these states, since a
 * dropdown offering the state everything is already in filters nothing.
 *
 * Books are listed by value alone: an analysis in no book is one nothing uses, which
 * {@link CatalogFilters} keeps on its own terms. A draft confined to a single book therefore offers
 * no books facet even where unused rows sit alongside the used ones: the unused are reachable on
 * those terms, the used only once a second book is in play.
 *
 * Assignment status is not a facet: only approved links count as usages, so every row agrees by
 * construction.
 */
export interface CatalogFacets {
  /** Canonical order. */
  books?: readonly string[];
  pos?: readonly (string | undefined)[];
  confidence?: readonly (Confidence | undefined)[];
  /** Distinct choices per feature name, each name judged on its own. */
  features?: Readonly<Record<string, readonly (string | undefined)[]>>;
}

/**
 * Collects the distinct values the rows carry for one field holding several at a time, sorted, or
 * `undefined` when fewer than two are present.
 */
function multiValueFacet<T>(
  rows: readonly CatalogRow[],
  valuesOf: (row: CatalogRow) => Iterable<T>,
  compare?: (a: T, b: T) => number,
): readonly T[] | undefined {
  const distinct = new Set(rows.flatMap((row) => [...valuesOf(row)]));
  return distinct.size < 2 ? undefined : [...distinct].sort(compare);
}

/**
 * Collects the choices the rows offer for one field holding a value at a time — the distinct values
 * sorted, then `undefined` where any row carries none — or `undefined` when the rows are all in one
 * state.
 */
function singleValueFacet<T>(
  rows: readonly CatalogRow[],
  valueOf: (row: CatalogRow) => T | undefined,
  compare?: (a: T, b: T) => number,
): readonly (T | undefined)[] | undefined {
  const present = new Set<T>();
  let anyUntagged = false;
  rows.forEach((row) => {
    const value = valueOf(row);
    if (value === undefined) anyUntagged = true;
    else present.add(value);
  });
  const sorted = [...present].sort(compare);
  const choices = anyUntagged ? [...sorted, undefined] : sorted;
  return choices.length < 2 ? undefined : choices;
}

/** Collects a facet per feature name that earns one, or `undefined` when no name does. */
function featureFacets(rows: readonly CatalogRow[]): CatalogFacets['features'] {
  const names = new Set(rows.flatMap((row) => Object.keys(row.features ?? {})));
  const facets = [...names].reduce<Record<string, readonly (string | undefined)[]>>((acc, name) => {
    const values = singleValueFacet(rows, (row) => row.features?.[name]);
    if (values) acc[name] = values;
    return acc;
  }, {});
  return Object.keys(facets).length === 0 ? undefined : facets;
}

/** Confidence levels from strongest to weakest. */
const CONFIDENCE_ORDER: readonly Confidence[] = ['high', 'medium', 'low', 'guess'];

/**
 * Derives the filter facets worth offering against these rows.
 *
 * @param rows Every row {@link buildCatalogRows} built, never what {@link applyCatalogQuery} narrowed
 *   them to: a facet judged against the rows its own selection kept collapses as soon as that
 *   selection is made, leaving nothing to widen it back by.
 */
export function deriveFacets(rows: readonly CatalogRow[]): CatalogFacets {
  return {
    books: multiValueFacet(
      rows,
      (row) => row.books,
      (a, b) => Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b),
    ),
    pos: singleValueFacet(rows, (row) => row.pos),
    confidence: singleValueFacet(
      rows,
      (row) => row.confidence,
      (a, b) => CONFIDENCE_ORDER.indexOf(a) - CONFIDENCE_ORDER.indexOf(b),
    ),
    features: featureFacets(rows),
  };
}

/**
 * Whether a chosen-value selection narrows anything. An empty selection is inactive rather than
 * unsatisfiable, so clearing every choice restores the full list.
 */
function isActive<T>(selected: readonly T[] | undefined): selected is readonly T[] {
  return selected !== undefined && selected.length > 0;
}

/**
 * Whether a field holding one value at a time is in a state its selection accepts, carrying no
 * value being the state the selection's `undefined` choice accepts.
 */
function passesValue<T>(
  selected: readonly (T | undefined)[] | undefined,
  value: T | undefined,
): boolean {
  return !isActive(selected) || selected.includes(value);
}

/** Whether the row satisfies every feature named in the selection, each judged on its own values. */
function passesFeatures(row: CatalogRow, selected: CatalogFilters['features']): boolean {
  if (!selected) return true;
  return Object.entries(selected).every(([name, values]) =>
    passesValue(values, row.features?.[name]),
  );
}

/** Whether the row survives every active filter. */
function passesFilters(row: CatalogRow, filters: CatalogFilters): boolean {
  if (isActive(filters.books) && !filters.books.some((book) => row.books.has(book))) return false;
  if (!passesValue(filters.pos, row.pos)) return false;
  if (!passesValue(filters.confidence, row.confidence)) return false;
  if (!passesFeatures(row, filters.features)) return false;
  if (filters.zeroUsages && row.usageCount > 0) return false;
  if (filters.missingGloss && row.gloss !== '') return false;
  if (filters.morphemes) {
    const hasMorphemes = row.morphemes.length > 0;
    if (hasMorphemes !== (filters.morphemes === 'has')) return false;
  }
  return true;
}

/**
 * Orders two rows by the query's sort key: counts descending, so the most used lead; text
 * ascending.
 */
function compareBySortKey(a: CatalogRow, b: CatalogRow, query: CatalogQuery): number {
  switch (query.sort) {
    case 'usageCountInBook':
      return b.usageCountInBook - a.usageCountInBook;
    case 'surfaceText':
      return query.surfaceCollator.compare(a.surfaceText, b.surfaceText);
    case 'gloss':
      return compareGloss(a, b, query.glossCollator);
    case 'firstUsage':
      return compareFirstUsage(a, b);
    default:
      return b.usageCount - a.usageCount;
  }
}

/** Orders two rows by their form ascending, falling back to their gloss. */
function compareByText(a: CatalogRow, b: CatalogRow, query: CatalogQuery): number {
  return (
    query.surfaceCollator.compare(a.surfaceText, b.surfaceText) ||
    compareGloss(a, b, query.glossCollator)
  );
}

/**
 * Orders two rows for the listing, falling back to their text where the sort key cannot separate
 * them, so the order holds still as unrelated analyses are recorded.
 */
function compareBySort(a: CatalogRow, b: CatalogRow, query: CatalogQuery): number {
  return compareBySortKey(a, b, query) || compareByText(a, b, query);
}

/**
 * Narrows rows to those the query's search and filters keep, in the order it asks for.
 *
 * Separate from {@link buildCatalogRows} so a keystroke re-runs only this pass: the analysis changes
 * on every gloss blur, and rebuilding rows per keystroke would re-fold unchanged text.
 */
export function applyCatalogQuery(
  rows: readonly CatalogRow[],
  query: CatalogQuery,
): readonly CatalogRow[] {
  // A newline separates the fields a match must not span, so a line ending typed into the query
  // reads as an ordinary space instead — including the carriage return a paste from a Windows
  // source carries, which no row's search text holds. That and the trim happen here rather than
  // inside foldForSearch, which also folds each row's search text, where the separators must
  // survive.
  const search = foldForSearch(query.search.replace(/\r\n?|\n/g, ' ').trim());
  return rows
    .filter((row) => row.searchText.includes(search) && passesFilters(row, query.filters))
    .sort((a, b) => compareBySort(a, b, query));
}
