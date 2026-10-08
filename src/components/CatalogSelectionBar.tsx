import { Button, Checkbox } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';

/** Localized string keys the selection bar renders. */
export const SELECTION_BAR_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_checkAll%',
  '%interlinearizer_analysisCatalog_checkedSummary%',
  '%interlinearizer_analysisCatalog_clearGlossChecked%',
  '%interlinearizer_analysisCatalog_delete%',
  '%interlinearizer_analysisCatalog_merge%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogSelectionBar}. */
type CatalogSelectionBarProps = Readonly<{
  /** How many rows are checked. */
  count: number;
  /** How many uses the checked rows have between them. */
  usageCount: number;
  /** Whether every listed row is checked. */
  allChecked: boolean;
  /** Checks every listed row, or unchecks them all. */
  onCheckAll: (checked: boolean) => void;
  /** Resolved localizations covering at least {@link SELECTION_BAR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** Clears the gloss on every checked analysis. */
  onClearGloss: () => void;
  /**
   * Opens a merge of the checked analyses. Absent unless they can be merged, which takes two or
   * more analyses of one form.
   */
  onMerge?: () => void;
  /** Deletes every checked analysis. */
  onDelete: () => void;
}>;

/**
 * Heads the catalog's list with a control checking every listed row, and once any is checked, the
 * actions that apply to all of them at once.
 */
export default function CatalogSelectionBar({
  count,
  usageCount,
  allChecked,
  onCheckAll,
  localizedStrings,
  onClearGloss,
  onMerge,
  onDelete,
}: CatalogSelectionBarProps) {
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:px-3 tw:py-2 tw:border-b tw:border-border">
      {/* As tall as a small button, so the list does not shift when the actions appear. */}
      <div className="tw:flex tw:h-7 tw:items-center">
        <Checkbox
          aria-label={localizedStrings['%interlinearizer_analysisCatalog_checkAll%']}
          checked={allChecked}
          className="tw:shrink-0"
          data-testid="catalog-check-all"
          onCheckedChange={onCheckAll}
        />
      </div>
      {count > 0 && (
        <>
          <span className="tw:text-sm tw:tabular-nums" data-testid="catalog-selection-summary">
            {formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_checkedSummary%'],
              { count, usageCount },
            )}
          </span>
          <div className="tw:ms-auto tw:flex tw:gap-1.5">
            {onMerge && (
              <Button
                data-testid="catalog-selection-merge"
                onClick={onMerge}
                size="sm"
                type="button"
                variant="outline"
              >
                {localizedStrings['%interlinearizer_analysisCatalog_merge%']}
              </Button>
            )}
            <Button
              data-testid="catalog-selection-clear-gloss"
              onClick={onClearGloss}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_clearGlossChecked%']}
            </Button>
            <Button
              className="tw:text-destructive"
              data-testid="catalog-selection-delete"
              onClick={onDelete}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_delete%']}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
