import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { memo, useCallback, useState } from 'react';
import type { CatalogRow, CatalogUsage } from '../utils/analysis-query';

/**
 * Localized string keys a row renders. Every row asks for the same strings, and subscribing per row
 * would be a subscription per analysis in the draft, so they are resolved above the list and handed
 * down.
 */
export const ROW_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_usageCount%',
  '%interlinearizer_analysisCatalog_usageCountInBook%',
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
  /** Finished label for `row.usageCountInBook`, naming the book that count was taken against. */
  usageCountInBookLabel: string;
  /** Whether this is the row the view was last jumped from. */
  isSelected: boolean;
  /** Jumps the interlinear view to one of this analysis's usages. */
  onUsageSelect: (analysisId: string, usage: CatalogUsage) => void;
  /** Resolved localizations covering at least {@link ROW_STRING_KEYS}, shared by the whole list. */
  localizedStrings: LanguageStrings;
  /** BCP 47 tag the morpheme glosses are read under. */
  analysisLanguage: string;
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
function CatalogRowView({
  row,
  usageCountInBookLabel,
  isSelected,
  onUsageSelect,
  localizedStrings,
  analysisLanguage,
}: CatalogRowViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  /** Whether the usage list is showing every usage rather than the first {@link INLINE_USAGE_LIMIT}. */
  const [showsAllUsages, setShowsAllUsages] = useState(false);

  // Collapsing returns the row to the inline cap: without it a row once expanded to hundreds of
  // usages has no way back, since the expander it was opened from is gone.
  const handleToggle = useCallback(() => {
    setIsExpanded((expanded) => !expanded);
    setShowsAllUsages(false);
  }, []);

  const visibleUsages = showsAllUsages ? row.usages : row.usages.slice(0, INLINE_USAGE_LIMIT);
  const hiddenUsageCount = row.usages.length - visibleUsages.length;

  const usageCountLabel = localizedStrings['%interlinearizer_analysisCatalog_usageCount%'];

  return (
    <li
      className={`tw:flex tw:flex-col tw:border-b tw:border-border ${
        isSelected ? 'tw:bg-accent/50' : ''
      }`}
      data-analysis-id={row.analysisId}
      data-selected={String(isSelected)}
      data-testid="catalog-row"
    >
      {/*
        Carries no `aria-label`: a name on a button overrides its content, so one here would
        announce every row alike and suppress the analysis each lists.
      */}
      <Button
        aria-expanded={isExpanded}
        // Overrides the platform button's own box: this is a row of the list, not a control
        // sitting in one.
        className="tw:flex tw:h-auto tw:w-full tw:items-baseline tw:justify-start tw:gap-2 tw:rounded-none tw:px-3 tw:py-2 tw:text-start tw:font-normal"
        data-testid="catalog-row-toggle"
        onClick={handleToggle}
        type="button"
        variant="ghost"
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
        {/*
          Native `title` rather than the platform Tooltip because these counts sit inside the row's
          own button, where a tooltip trigger would nest one interactive element in another. A
          `title` on a span is not reliably announced, hence the screen-reader-only labels.
        */}
        <span
          className="tw:text-xs tw:tabular-nums"
          data-testid="catalog-row-usage-count"
          title={usageCountLabel}
        >
          {row.usageCount}
          <span className="tw:sr-only">{` ${usageCountLabel}`}</span>
        </span>
        <span
          className="tw:text-xs tw:tabular-nums tw:text-muted-foreground"
          data-testid="catalog-row-usage-count-in-book"
          title={usageCountInBookLabel}
        >
          {row.usageCountInBook}
          <span className="tw:sr-only">{` ${usageCountInBookLabel}`}</span>
        </span>
      </Button>

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

/** Memoized version of {@link CatalogRowView}; use in render-stable row lists. */
const MemoizedCatalogRowView = memo(CatalogRowView);
export default MemoizedCatalogRowView;
