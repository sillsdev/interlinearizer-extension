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
  /**
   * Gloss in the scope's analysis language; `''` when the analysis has none, blank counting as
   * none.
   */
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
  /**
   * Keeps rows used in at least one of these books. A row nothing uses sits in no book, so an
   * active selection drops every unused row.
   */
  books?: readonly string[];
  /** Keeps rows carrying one of these parts of speech. */
  pos?: readonly (string | undefined)[];
  /** Keeps rows carrying one of these confidence levels. */
  confidence?: readonly (Confidence | undefined)[];
  /** Keeps rows matching every named feature, each against its own accepted values. */
  features?: Readonly<Record<string, readonly (string | undefined)[]>>;
  /** Keeps only rows nothing uses. Those sit in no book, so a book selection alongside keeps none. */
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
   * `''` matches everything, as does anything the fold empties — a query of combining marks alone
   * leaves the list at its full width rather than emptying it.
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
 *
 * Every part is taken as the tokenizer wrote it rather than validated: a ref reaching here names a
 * token of a tokenized book, never anything a user typed.
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

/**
 * Orders two usages by document position, taking books in canonical rather than alphabetical order.
 *
 * Total over the refs a tokenized book produces, whose parts are all present and whose book code is
 * canonical. A code outside the canon has no number to be placed by and would lead the list rather
 * than trail it.
 */
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
 * applied. A token counts once however many approved links carry it, so a row's count equals the
 * analysis's frequency in the suggestion pool — which counts the tokens an approval sits on rather
 * than the approvals themselves — whatever a duplicate link says.
 */
function groupUsagesByAnalysisId(
  links: readonly TokenAnalysisLink[],
): ReadonlyMap<string, CatalogUsage[]> {
  const byId = links.reduce((acc, l) => {
    if (l.status !== 'approved') return acc;
    const usages = acc.get(l.analysisId) ?? new Map<string, CatalogUsage>();
    usages.set(l.token.tokenRef, parseUsage(l.token.tokenRef));
    return acc.set(l.analysisId, usages);
  }, new Map<string, Map<string, CatalogUsage>>());
  return new Map(
    [...byId].map(([id, usages]) => [id, [...usages.values()].sort(compareDocumentOrder)]),
  );
}

/** Separates the fields a match may not span, and so the one character no field may hold. */
const FIELD_SEPARATOR = '\n';

/** Reads a line ending as the ordinary space it stands for between words. */
function collapseLineEndings(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ');
}

/**
 * The folded text each analysis is searched by, held against the record it was folded from, so a
 * write re-folds the one analysis it replaced. A record edited in place rather than replaced would
 * keep the fold it arrived with.
 */
const searchTextByAnalysis = new WeakMap<TokenAnalysis, string>();

/**
 * Assembles the folded text a search matches an analysis by, drawing on its forms and on every
 * gloss it carries whatever the language, so a gloss stays findable in a language the project does
 * not declare. No match spans two of the assembled fields: a line ending inside a field contributes
 * a space, so the separator between fields is the only one in the text.
 */
function buildSearchText(ta: TokenAnalysis): string {
  const cached = searchTextByAnalysis.get(ta);
  if (cached !== undefined) return cached;

  const morphemeText = (ta.morphemes ?? []).flatMap((m) => [
    m.form,
    ...Object.values(m.gloss ?? {}),
  ]);
  const searchText = foldForSearch(
    [ta.surfaceText, ...Object.values(ta.gloss ?? {}), ...morphemeText]
      .map(collapseLineEndings)
      .join(FIELD_SEPARATOR),
  );
  searchTextByAnalysis.set(ta, searchText);
  return searchText;
}

/**
 * Reads the gloss a row is listed and filtered by, a blank one reading as no gloss at all — the
 * reading the analysis layer takes everywhere else. A write clears a blank gloss rather than
 * storing it, so a stored blank is one a project file arrived carrying.
 */
function glossForScope(ta: TokenAnalysis, analysisLanguage: string): string {
  const gloss = ta.gloss?.[analysisLanguage] ?? '';
  return gloss.trim() === '' ? '' : gloss;
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
      gloss: glossForScope(ta, scope.analysisLanguage),
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
 * Assembles the choices for one field holding a value at a time — the distinct values sorted, then
 * `undefined` where the field goes untagged — or `undefined` when fewer than two choices result, a
 * lone choice being the state everything is already in.
 */
function valueChoices<T>(
  present: ReadonlySet<T>,
  anyUntagged: boolean,
  compare?: (a: T, b: T) => number,
): readonly (T | undefined)[] | undefined {
  const sorted = [...present].sort(compare);
  const choices = anyUntagged ? [...sorted, undefined] : sorted;
  return choices.length < 2 ? undefined : choices;
}

/**
 * Collects the choices the rows offer for one field holding a value at a time, or `undefined` when
 * the rows are all in one state.
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
  return valueChoices(present, anyUntagged, compare);
}

/**
 * Collects a facet per feature name that earns one, or `undefined` when no name does. A row counts
 * as untagged for every name its own feature map omits.
 */
function featureFacets(rows: readonly CatalogRow[]): CatalogFacets['features'] {
  const tallies = new Map<string, { values: Set<string>; taggedRows: number }>();
  rows.forEach((row) => {
    Object.entries(row.features ?? {}).forEach(([name, value]) => {
      const tally = tallies.get(name) ?? { values: new Set<string>(), taggedRows: 0 };
      tally.values.add(value);
      tally.taggedRows += 1;
      tallies.set(name, tally);
    });
  });
  const facets = [...tallies].reduce<Record<string, readonly (string | undefined)[]>>(
    (acc, [name, { values, taggedRows }]) => {
      const choices = valueChoices(values, taggedRows < rows.length);
      if (choices) acc[name] = choices;
      return acc;
    },
    {},
  );
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
 *
 * A key added to {@link CatalogSort} fails to compile here until this orders it too.
 */
function compareBySortKey(a: CatalogRow, b: CatalogRow, query: CatalogQuery): number {
  switch (query.sort) {
    case 'usageCount':
      return b.usageCount - a.usageCount;
    case 'usageCountInBook':
      return b.usageCountInBook - a.usageCountInBook;
    case 'surfaceText':
      return query.surfaceCollator.compare(a.surfaceText, b.surfaceText);
    case 'gloss':
      return compareGloss(a, b, query.glossCollator);
    case 'firstUsage':
      return compareFirstUsage(a, b);
    // no default
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
  // A line ending typed or pasted into the query reads as the ordinary space it stands for, rather
  // than as the separator a match may not span, so it is collapsed here rather than inside
  // foldForSearch, which also folds each row's search text, where the separators survive. Trimming
  // follows the fold rather than preceding it: a spacing diacritic decomposes to a bare space, so
  // it is whitespace only once folded.
  const search = foldForSearch(collapseLineEndings(query.search)).trim();
  return rows
    .filter((row) => row.searchText.includes(search) && passesFilters(row, query.filters))
    .toSorted((a, b) => compareBySort(a, b, query));
}
