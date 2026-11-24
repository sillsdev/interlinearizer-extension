import type { TextAnalysis } from 'interlinearizer';
import { SUMMARY_PLACE_COUNT, type TokenAnalysisSummary } from '../types/analysis-repository';
import {
  applyCatalogQuery,
  buildCatalogEntries,
  buildCatalogRows,
  catalogKeyOrder,
  catalogOrder,
  deriveFacets,
  narrowCatalog,
  placeUsages,
  type CatalogEntry,
  type CatalogQuery,
  type CatalogFacets,
  type CatalogFilters,
  type CatalogRow,
  type CatalogScope,
  type CatalogSort,
  type CatalogUsage,
} from '../utils/analysis-query';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { firstInOrder } from '../utils/first-in-order';
import { collatorForTag } from '../utils/language-tags';

/** What a view asks of the catalog: how to narrow and order the rows, and which of them to send. */
export interface CatalogPageRequest {
  search: string;
  sort: CatalogSort;
  filters: CatalogFilters;
  /** BCP 47 tag of the source text, whose collation orders surface forms. */
  sourceLanguageTag: string;
  /** How many of the kept rows to skip. */
  offset: number;
  /** How many rows to send at most. */
  count: number;
}

/**
 * How many of a row's usages, and how many of its stale places, a catalog page carries. The rest
 * are read on demand, because a much-used analysis has thousands of places.
 */
export const CATALOG_INLINE_PLACES = SUMMARY_PLACE_COUNT;

/** A catalog row as a page carries it. */
export interface CatalogPageRow extends Omit<
  CatalogRow,
  'usages' | 'staleLocations' | 'searchText' | 'firstUsage' | 'staleBooks'
> {
  /**
   * The row's first usages in document order, at most {@link CATALOG_INLINE_PLACES}. `usageCount`
   * counts every usage.
   */
  firstUsages: readonly CatalogUsage[];
  /**
   * The row's first stale places in document order, at most {@link CATALOG_INLINE_PLACES}.
   * `staleCount` counts every stale place.
   */
  firstStaleLocations: readonly CatalogUsage[];
  /**
   * Whether another row shares the row's surface form, normalized as the suggestion pool buckets
   * forms, so the two can be merged.
   */
  hasHomograph: boolean;
  /** Whether the text is known to lack the row's form; `false` while the text is unread. */
  isNotInText: boolean;
}

/** One page of the rows a {@link CatalogPageRequest} keeps. */
export interface CatalogPage {
  rows: readonly CatalogPageRow[];
  /** How many rows the request keeps, on this page and off it. */
  keptCount: number;
  /** How many rows the draft holds, the query aside. */
  rowCount: number;
  /** The filter choices worth offering, taken against every row rather than the kept ones. */
  facets: CatalogFacets;
}

/** How a {@link CatalogPageRequest} narrows and orders the entries. */
function queryOf(
  scope: CatalogScope,
  request: Omit<CatalogPageRequest, 'offset' | 'count'>,
  isFormInText: (form: string) => boolean | undefined,
): CatalogQuery {
  return {
    search: request.search,
    sort: request.sort,
    filters: request.filters,
    surfaceCollator: collatorForTag(request.sourceLanguageTag),
    glossCollator: collatorForTag(scope.analysisLanguage),
    isFormInText,
  };
}

/** What the catalog derives from a list of summaries whatever the scope. */
type ScopeFreeDerivations = Readonly<{
  facets: CatalogFacets;
  /** How many entries share each normalized surface form. */
  formCounts: ReadonlyMap<string, number>;
}>;

/**
 * What the catalog derives from each list of summaries, kept so that a list returned again is
 * derived once.
 */
const scopeFreeBySummaries = new WeakMap<readonly TokenAnalysisSummary[], ScopeFreeDerivations>();

function scopeFreeOf(
  summaries: readonly TokenAnalysisSummary[],
  entries: readonly CatalogEntry[],
): ScopeFreeDerivations {
  const kept = scopeFreeBySummaries.get(summaries);
  if (kept) return kept;
  const formCounts = new Map<string, number>();
  entries.forEach(({ form }) => formCounts.set(form, (formCounts.get(form) ?? 0) + 1));
  const derived = { facets: deriveFacets(entries), formCounts };
  scopeFreeBySummaries.set(summaries, derived);
  return derived;
}

/**
 * Narrows and orders the catalog's entries as the request asks, and returns the page it asks for.
 *
 * @param summaries Every token analysis, with totals of the token links to it.
 * @param scope The values every row is derived relative to.
 * @param request How to narrow and order the rows, and which of them to send.
 * @param isFormInText Whether the text holds a normalized word form, `undefined` until the whole
 *   text has been read.
 */
export function getCatalogPage(
  summaries: readonly TokenAnalysisSummary[],
  scope: CatalogScope,
  request: CatalogPageRequest,
  isFormInText: (form: string) => boolean | undefined,
): CatalogPage {
  const entries = buildCatalogEntries(summaries, scope);
  const query = queryOf(scope, request, isFormInText);
  const kept = narrowCatalog(entries, query);
  const end = request.offset + request.count;
  // The sort key alone is far cheaper to compare than the text that breaks its ties, so it narrows
  // the rows to those that can reach the page before they are put in order.
  const byKey = catalogKeyOrder(query);
  const last = firstInOrder(kept, end, byKey).at(-1);
  const candidates = last ? kept.filter((entry) => byKey(entry, last) <= 0) : [];
  const leading = firstInOrder(candidates, end, catalogOrder(query));
  const page = leading.slice(request.offset);
  const pageIds = new Set(page.map(({ analysisId }) => analysisId));
  const summaryById = new Map(
    summaries.flatMap((summary) =>
      pageIds.has(summary.analysis.id) ? [[summary.analysis.id, summary] as const] : [],
    ),
  );
  const { facets, formCounts } = scopeFreeOf(summaries, entries);
  const pageRow = (entry: CatalogEntry): CatalogPageRow => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave them out
    const { searchText, firstUsage, staleBooks, ...row } = entry;
    const summary = summaryById.get(entry.analysisId);
    /* v8 ignore next -- every entry is built from a summary */
    if (!summary) throw new Error(`No summary for analysis ${entry.analysisId}`);
    return {
      ...row,
      firstUsages: placeUsages(summary.firstApprovals, scope).slice(0, CATALOG_INLINE_PLACES),
      firstStaleLocations: placeUsages(summary.firstStale, scope).slice(0, CATALOG_INLINE_PLACES),
      /* v8 ignore next -- every entry's form is counted */
      hasHomograph: (formCounts.get(entry.form) ?? 0) > 1,
      isNotInText: isFormInText(entry.form) === false,
    };
  };
  return {
    rows: page.map(pageRow),
    keptCount: kept.length,
    rowCount: entries.length,
    facets,
  };
}

/**
 * Where in the listing that `request` asks for each kept analysis sits, in listing order: those of
 * `analysisIds`, or every kept one when `analysisIds` is absent. An analysis the request does not
 * keep is left out.
 */
export function locateCatalogRows(
  summaries: readonly TokenAnalysisSummary[],
  scope: CatalogScope,
  request: Omit<CatalogPageRequest, 'offset' | 'count'>,
  isFormInText: (form: string) => boolean | undefined,
  analysisIds?: readonly string[],
): [analysisId: string, index: number][] {
  const listing = applyCatalogQuery(
    buildCatalogEntries(summaries, scope),
    queryOf(scope, request, isFormInText),
  );
  const wanted = analysisIds && new Set(analysisIds);
  return listing.flatMap(({ analysisId }, index): [string, number][] =>
    !wanted || wanted.has(analysisId) ? [[analysisId, index]] : [],
  );
}

/** How many distinct tokens approve any of the analyses. */
export function countUsages(
  analysis: Pick<TextAnalysis, 'tokenAnalysisLinks'>,
  analysisIds: readonly string[],
): number {
  const ids = new Set(analysisIds);
  return new Set(
    analysis.tokenAnalysisLinks
      .filter((link) => link.status === 'approved' && ids.has(link.analysisId))
      .map((link) => link.token.tokenRef),
  ).size;
}

/** Builds the rows of the analyses `analysisIds` names, in that order, leaving out unstored ids. */
export function getRowsByIds(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
  analysisIds: readonly string[],
): readonly CatalogRow[] {
  const ids = new Set(analysisIds);
  const rows = buildCatalogRows(
    { ...analysis, tokenAnalyses: analysis.tokenAnalyses.filter((ta) => ids.has(ta.id)) },
    scope,
  );
  const rowById = new Map(rows.map((row) => [row.analysisId, row]));
  return analysisIds.flatMap((id) => rowById.get(id) ?? []);
}

/** Every place an analysis is applied, and every place it went stale at, in document order. */
export type CatalogPlaces = Readonly<{
  usages: readonly CatalogUsage[];
  staleLocations: readonly CatalogUsage[];
}>;

/**
 * Lists the places of the analysis that `analysisId` names, as its catalog row would. Returns
 * `undefined` when no analysis carries the id.
 */
export function getCatalogPlaces(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
  analysisId: string,
): CatalogPlaces | undefined {
  const [row] = getRowsByIds(analysis, scope, [analysisId]);
  return row && { usages: row.usages, staleLocations: row.staleLocations };
}

/**
 * Builds the rows of every analysis whose surface form matches the form of the analysis that
 * `analysisId` names, most used first. Forms match once normalized as the suggestion pool buckets
 * them. Returns `[]` when no analysis carries the id.
 */
export function getHomographRows(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
  analysisId: string,
): readonly CatalogRow[] {
  const target = analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
  if (!target) return [];
  const form = normalizeSurfaceForm(target.surfaceText);
  return buildCatalogRows(
    {
      ...analysis,
      tokenAnalyses: analysis.tokenAnalyses.filter(
        (ta) => normalizeSurfaceForm(ta.surfaceText) === form,
      ),
    },
    scope,
  ).toSorted((a, b) => b.usageCount - a.usageCount);
}

/** What a bulk action over the selected analyses would reach. */
export interface SelectionSummary {
  /** How many distinct tokens approve any of the analyses. */
  usageCount: number;
  /** The analyses carrying a gloss in the analysis language, which a gloss clear reaches. */
  glossedIds: readonly string[];
  /**
   * The merge of the analyses into the most used of them, or `undefined` unless at least two are
   * selected and all are homographs.
   */
  merge?: Readonly<{ survivorId: string; mergedIds: readonly string[] }>;
}

/**
 * Summarizes the analyses `analysisIds` names for a bulk action over them. A tie in use for the
 * merge's survivor goes to the analysis named first.
 */
export function summarizeSelection(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
  analysisIds: readonly string[],
): SelectionSummary {
  const rows = getRowsByIds(analysis, scope, analysisIds);
  const form = rows[0] && normalizeSurfaceForm(rows[0].surfaceText);
  const isMergeable =
    rows.length > 1 && rows.every((row) => normalizeSurfaceForm(row.surfaceText) === form);
  const [survivor, ...merged] = rows.toSorted((a, b) => b.usageCount - a.usageCount);
  return {
    usageCount: countUsages(analysis, analysisIds),
    glossedIds: rows.filter((row) => row.gloss).map((row) => row.analysisId),
    ...(isMergeable && {
      merge: { survivorId: survivor.analysisId, mergedIds: merged.map((row) => row.analysisId) },
    }),
  };
}

/** Turns each `null` in `choices` back into the `undefined` that JSON wrote it for. */
function untagged<T>(choices: readonly (T | undefined)[]): (T | undefined)[] {
  return choices.map((choice) => choice ?? undefined);
}

/**
 * Filters or facets as sent, with the choice for carrying no value restored: JSON writes that
 * choice, `undefined`, as `null`.
 */
export function restoreUntagged<T extends CatalogFilters | CatalogFacets>(choices: T): T {
  const { pos, confidence, features } = choices;
  return {
    ...choices,
    ...(pos && { pos: untagged(pos) }),
    ...(confidence && { confidence: untagged(confidence) }),
    ...(features && {
      features: Object.fromEntries(
        Object.entries(features).map(([name, values]) => [name, untagged(values)]),
      ),
    }),
  };
}
