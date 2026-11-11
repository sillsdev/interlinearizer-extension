import type { TextAnalysis } from 'interlinearizer';
import {
  applyCatalogQuery,
  buildCatalogRows,
  deriveFacets,
  type CatalogFacets,
  type CatalogFilters,
  type CatalogRow,
  type CatalogScope,
  type CatalogSort,
} from '../utils/analysis-query';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
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

/** A catalog row as a page carries it. */
export interface CatalogPageRow extends CatalogRow {
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
  /** The id of every row the request keeps, in order, on this page and off it. */
  keptIds: readonly string[];
  /** How many rows the draft holds, the query aside. */
  rowCount: number;
  /** The filter choices worth offering, taken against every row rather than the kept ones. */
  facets: CatalogFacets;
}

/**
 * Builds the catalog's rows over the analysis and returns the page the request asks for.
 *
 * @param analysis The analyses and links the rows are built from.
 * @param scope The values every row is derived relative to.
 * @param request How to narrow and order the rows, and which of them to send.
 * @param isFormInText Whether the text holds a normalized word form, `undefined` until the whole
 *   text has been read.
 */
export function getCatalogPage(
  analysis: Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>,
  scope: CatalogScope,
  request: CatalogPageRequest,
  isFormInText: (form: string) => boolean | undefined,
): CatalogPage {
  const rows = buildCatalogRows(analysis, scope);
  const kept = applyCatalogQuery(rows, {
    search: request.search,
    sort: request.sort,
    filters: request.filters,
    surfaceCollator: collatorForTag(request.sourceLanguageTag),
    glossCollator: collatorForTag(scope.analysisLanguage),
    isFormInText,
  });
  const rowsByForm = Map.groupBy(rows, (row) => normalizeSurfaceForm(row.surfaceText));
  return {
    rows: kept.slice(request.offset, request.offset + request.count).map((row) => ({
      ...row,
      /* v8 ignore next -- every row is filed under its own form */
      hasHomograph: (rowsByForm.get(normalizeSurfaceForm(row.surfaceText))?.length ?? 0) > 1,
      isNotInText: isFormInText(row.form) === false,
    })),
    keptIds: kept.map((row) => row.analysisId),
    rowCount: rows.length,
    facets: deriveFacets(rows),
  };
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

/**
 * Builds the rows of every analysis whose surface form matches that of the analysis `analysisId`
 * names, most used first. Forms match once normalized as the suggestion pool buckets them.
 * Returns `[]` when no analysis carries the id.
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
