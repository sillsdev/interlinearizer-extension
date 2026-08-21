import {
  SearchBar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import CatalogFilterPopover, { FILTER_STRING_KEYS } from './CatalogFilterPopover';
import type { CatalogFacets, CatalogFilters, CatalogSort } from '../utils/analysis-query';

/**
 * The label each sort key is offered under, in this object's declaration order. Covers every member
 * of {@link CatalogSort}, so a key added there fails to compile until it is labeled here too.
 */
const SORT_LABEL_KEYS = {
  usageCount: '%interlinearizer_analysisCatalog_sort_usageCount%',
  usageCountInBook: '%interlinearizer_analysisCatalog_sort_usageCountInBook%',
  firstUsage: '%interlinearizer_analysisCatalog_sort_firstUsage%',
  surfaceText: '%interlinearizer_analysisCatalog_sort_surfaceText%',
  gloss: '%interlinearizer_analysisCatalog_sort_gloss%',
} as const satisfies Record<CatalogSort, `%${string}%`>;

function isSortKey(value: string): value is CatalogSort {
  return value in SORT_LABEL_KEYS;
}

/** Localized string keys the query controls render. */
export const QUERY_CONTROL_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_searchPlaceholder%',
  '%interlinearizer_analysisCatalog_sort%',
  ...Object.values(SORT_LABEL_KEYS),
  ...FILTER_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogQueryControls}. */
type CatalogQueryControlsProps = Readonly<{
  /** The query the search box holds, verbatim. */
  search: string;
  /** Records a new search query. */
  onSearchChange: (search: string) => void;
  /** The sort key the listing is ordered by. */
  sort: CatalogSort;
  /** Records a new sort key. */
  onSortChange: (sort: CatalogSort) => void;
  /** The choices worth offering as filters, derived from every row rather than the narrowed ones. */
  facets: CatalogFacets;
  /** The filters currently narrowing the listing. */
  filters: CatalogFilters;
  /** Records a new set of filters. */
  onFiltersChange: (filters: CatalogFilters) => void;
  /** BCP 47 tag the missing-gloss filter asks about. */
  analysisLanguage: string;
  /** Book code the per-book sort is named after. */
  currentBook: string;
  /** Resolved localizations covering at least {@link QUERY_CONTROL_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * The controls that vary the catalog's listing: a search box across the full width, and beneath it
 * the sort and filter controls.
 *
 * The placeholder promises forms and glosses because that is all the query matches, and matches as
 * a single substring — so it must not imply a syntax that would let a multi-word query span two of
 * the fields it is matched against.
 */
export default function CatalogQueryControls({
  search,
  onSearchChange,
  sort,
  onSortChange,
  facets,
  filters,
  onFiltersChange,
  analysisLanguage,
  currentBook,
  localizedStrings,
}: CatalogQueryControlsProps) {
  const sortKeys = Object.keys(SORT_LABEL_KEYS).filter(isSortKey);

  return (
    <div className="tw:flex tw:flex-col tw:gap-2 tw:border-b tw:border-border tw:px-3 tw:py-2">
      <SearchBar
        isFullWidth
        onSearch={onSearchChange}
        placeholder={localizedStrings['%interlinearizer_analysisCatalog_searchPlaceholder%']}
        value={search}
      />

      <div className="tw:flex tw:items-center tw:gap-2">
        <Select
          onValueChange={(value) => {
            /* v8 ignore next -- the select only ever reports back one of the keys it was given */
            if (isSortKey(value)) onSortChange(value);
          }}
          value={sort}
        >
          <SelectTrigger
            aria-label={localizedStrings['%interlinearizer_analysisCatalog_sort%']}
            className="tw:min-w-0 tw:flex-1"
            data-testid="catalog-sort"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortKeys.map((sortKey) => (
              <SelectItem data-testid={`catalog-sort-${sortKey}`} key={sortKey} value={sortKey}>
                {formatReplacementString(localizedStrings[SORT_LABEL_KEYS[sortKey]], {
                  book: currentBook,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <CatalogFilterPopover
          analysisLanguage={analysisLanguage}
          facets={facets}
          filters={filters}
          localizedStrings={localizedStrings}
          onFiltersChange={onFiltersChange}
        />
      </div>
    </div>
  );
}
