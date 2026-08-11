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
  features?: Record<string, string>;
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

/** Which rows are kept. An absent filter is inactive, as is an empty selection. */
export interface CatalogFilters {
  /** Keeps rows used in at least one of these books. */
  books?: readonly string[];
  /** Keeps rows carrying one of these parts of speech. */
  pos?: readonly string[];
  /** Keeps rows carrying one of these confidence levels. */
  confidence?: readonly Confidence[];
  /** Keeps rows matching every named feature, each against its own accepted values. */
  features?: Readonly<Record<string, readonly string[]>>;
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
 * applied, and counting approvals alone keeps a row's count equal to the analysis's frequency in
 * the suggestion pool, so the two can never disagree.
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
 * The closed-vocabulary values present in the rows, each offered as a filter.
 *
 * A facet is absent unless the rows disagree on it — a dropdown with one choice filters nothing.
 * Assignment status is not a facet: only approved links count as usages, so every row agrees by
 * construction.
 */
export interface CatalogFacets {
  /** Canonical order. */
  books?: readonly string[];
  pos?: readonly string[];
  confidence?: readonly Confidence[];
  /** Distinct values per feature name, each name judged on its own. */
  features?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Collects the distinct values the rows carry for one field, sorted, or `undefined` when fewer than
 * two are present.
 */
function facetValues<T>(
  rows: readonly CatalogRow[],
  valuesOf: (row: CatalogRow) => Iterable<T>,
  compare?: (a: T, b: T) => number,
): readonly T[] | undefined {
  const distinct = new Set(rows.flatMap((row) => [...valuesOf(row)]));
  return distinct.size < 2 ? undefined : [...distinct].sort(compare);
}

/** Collects a facet per feature name that earns one, or `undefined` when no name does. */
function featureFacets(rows: readonly CatalogRow[]): CatalogFacets['features'] {
  const names = new Set(rows.flatMap((row) => Object.keys(row.features ?? {})));
  const facets = [...names].reduce<Record<string, readonly string[]>>((acc, name) => {
    const values = facetValues(rows, (row) => {
      const value = row.features?.[name];
      return value === undefined ? [] : [value];
    });
    if (values) acc[name] = values;
    return acc;
  }, {});
  return Object.keys(facets).length === 0 ? undefined : facets;
}

/** Confidence levels from strongest to weakest. */
const CONFIDENCE_ORDER: readonly Confidence[] = ['high', 'medium', 'low', 'guess'];

/** Derives the filter facets worth offering against these rows. */
export function deriveFacets(rows: readonly CatalogRow[]): CatalogFacets {
  return {
    books: facetValues(
      rows,
      (row) => row.books,
      (a, b) => Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b),
    ),
    pos: facetValues(rows, (row) => (row.pos === undefined ? [] : [row.pos])),
    confidence: facetValues(
      rows,
      (row) => (row.confidence === undefined ? [] : [row.confidence]),
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
 * Whether a field holding one value at a time carries one its selection accepts. A field carrying
 * no value at all fails an active selection.
 */
function passesValue<T>(selected: readonly T[] | undefined, value: T | undefined): boolean {
  return !isActive(selected) || (value !== undefined && selected.includes(value));
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
function compareBySort(a: CatalogRow, b: CatalogRow, query: CatalogQuery): number {
  switch (query.sort) {
    case 'usageCountInBook':
      return b.usageCountInBook - a.usageCountInBook;
    case 'surfaceText':
      return query.surfaceCollator.compare(a.surfaceText, b.surfaceText);
    case 'gloss':
      return query.glossCollator.compare(a.gloss, b.gloss);
    case 'firstUsage':
      return compareFirstUsage(a, b);
    default:
      return b.usageCount - a.usageCount;
  }
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
  // A newline separates the fields a match must not span, so one typed into the query reads as an
  // ordinary space instead. That and the trim happen here rather than inside foldForSearch, which
  // also folds each row's search text, where the separators must survive.
  const search = foldForSearch(query.search.replace(/\n/g, ' ').trim());
  return rows
    .filter((row) => row.searchText.includes(search) && passesFilters(row, query.filters))
    .sort((a, b) => compareBySort(a, b, query));
}
