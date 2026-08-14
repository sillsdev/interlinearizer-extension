import { useLocalizedStrings } from '@papi/frontend/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useState } from 'react';
import { useAnalysisLanguage } from './AnalysisStore';
import type { CatalogRow, CatalogUsage } from '../utils/analysis-query';

/**
 * Localized string keys a row needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders; a fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_usageCount%',
  '%interlinearizer_analysisCatalog_usageCountInBook%',
  '%interlinearizer_analysisCatalog_expandRow%',
  '%interlinearizer_analysisCatalog_collapseRow%',
  '%interlinearizer_analysisCatalog_noUsages%',
  '%interlinearizer_analysisCatalog_showAllUsages%',
] as const satisfies `%${string}%`[];

/**
 * How many usages an expanded row lists before the rest go behind an expander. An analysis applied
 * across a whole book has hundreds; listing them all would bury every row beneath it.
 */
const INLINE_USAGE_LIMIT = 12;

/** Props for {@link CatalogRowView}. */
type CatalogRowViewProps = Readonly<{
  /** The analysis this row lists. */
  row: CatalogRow;
  /** Book code `row.usageCountInBook` was taken against, named in that count's label. */
  currentBook: string;
  /** Whether this is the row the view was last jumped from. */
  isSelected: boolean;
  /** Jumps the interlinear view to one of this analysis's usages. */
  onUsageSelect: (analysisId: string, usage: CatalogUsage) => void;
}>;

/** Renders a usage's location the way scripture references are written, e.g. `GEN 1:1`. */
function usageLabel(usage: CatalogUsage): string {
  return `${usage.book} ${usage.chapter}:${usage.verse}`;
}

/**
 * One analysis in the catalog: its surface form and gloss, and how much of the draft it accounts
 * for — the whole draft's usage count beside the current book's. Expanding it reveals the morpheme
 * breakdown and the places the analysis is applied.
 *
 * Each row owns its own layout so that its detail can be nested inside it. One element per analysis
 * is what lets the list window and be walked by keyboard a row at a time.
 */
export default function CatalogRowView({
  row,
  currentBook,
  isSelected,
  onUsageSelect,
}: CatalogRowViewProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const analysisLanguage = useAnalysisLanguage();

  const [isExpanded, setIsExpanded] = useState(false);

  /** Whether the usage list is showing every usage rather than the first {@link INLINE_USAGE_LIMIT}. */
  const [showsAllUsages, setShowsAllUsages] = useState(false);

  const visibleUsages = showsAllUsages ? row.usages : row.usages.slice(0, INLINE_USAGE_LIMIT);
  const hiddenUsageCount = row.usages.length - visibleUsages.length;

  return (
    <li
      className={`tw:flex tw:flex-col tw:border-b tw:border-border ${
        isSelected ? 'tw:bg-accent/50' : ''
      }`}
      data-analysis-id={row.analysisId}
      data-selected={String(isSelected)}
      data-testid="catalog-row"
    >
      <button
        aria-expanded={isExpanded}
        aria-label={
          localizedStrings[
            isExpanded
              ? '%interlinearizer_analysisCatalog_collapseRow%'
              : '%interlinearizer_analysisCatalog_expandRow%'
          ]
        }
        className="tw:flex tw:items-baseline tw:gap-2 tw:px-3 tw:py-2 tw:text-start tw:hover:bg-accent"
        data-testid="catalog-row-toggle"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        type="button"
      >
        {isExpanded ? (
          <ChevronDown className="tw:size-3 tw:shrink-0" />
        ) : (
          <ChevronRight className="tw:size-3 tw:shrink-0" />
        )}
        <span
          className="tw:flex-1 tw:min-w-0 tw:truncate tw:font-medium"
          data-testid="catalog-row-surface"
        >
          {row.surfaceText}
        </span>
        <span
          className="tw:flex-1 tw:min-w-0 tw:truncate tw:text-sm tw:text-muted-foreground"
          data-testid="catalog-row-gloss"
        >
          {row.gloss || localizedStrings['%interlinearizer_analysisCatalog_noGloss%']}
        </span>
        <span
          className="tw:text-xs tw:tabular-nums"
          data-testid="catalog-row-usage-count"
          title={localizedStrings['%interlinearizer_analysisCatalog_usageCount%']}
        >
          {row.usageCount}
        </span>
        <span
          className="tw:text-xs tw:tabular-nums tw:text-muted-foreground"
          data-testid="catalog-row-usage-count-in-book"
          title={formatReplacementString(
            localizedStrings['%interlinearizer_analysisCatalog_usageCountInBook%'],
            { book: currentBook },
          )}
        >
          {row.usageCountInBook}
        </span>
      </button>

      {isExpanded && (
        <div
          className="tw:flex tw:flex-col tw:gap-2 tw:px-3 tw:pb-2 tw:ps-8"
          data-testid="catalog-row-detail"
        >
          {row.morphemes.length > 0 && (
            <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
              {row.morphemes.map((morpheme) => (
                // Form above gloss, as the interlinear view arranges them, so a breakdown reads the
                // same in both places.
                <div
                  className="tw:flex tw:flex-col"
                  data-testid="catalog-row-morpheme"
                  key={morpheme.id}
                >
                  <span className="tw:text-sm">{morpheme.form}</span>
                  <span className="tw:text-xs tw:text-muted-foreground">
                    {morpheme.gloss?.[analysisLanguage] ?? ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {row.usages.length === 0 ? (
            <p className="tw:text-xs tw:text-muted-foreground">
              {localizedStrings['%interlinearizer_analysisCatalog_noUsages%']}
            </p>
          ) : (
            <div className="tw:flex tw:flex-wrap tw:gap-1">
              {visibleUsages.map((usage) => (
                <Button
                  className="tw:h-auto tw:px-1 tw:py-0 tw:text-xs"
                  data-testid="catalog-usage"
                  data-token-ref={usage.tokenRef}
                  key={usage.tokenRef}
                  onClick={() => onUsageSelect(row.analysisId, usage)}
                  size="sm"
                  variant="link"
                >
                  {usageLabel(usage)}
                </Button>
              ))}
              {hiddenUsageCount > 0 && (
                <Button
                  data-testid="catalog-usages-show-all"
                  onClick={() => setShowsAllUsages(true)}
                  size="sm"
                  variant="link"
                >
                  {formatReplacementString(
                    localizedStrings['%interlinearizer_analysisCatalog_showAllUsages%'],
                    { count: hiddenUsageCount },
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
