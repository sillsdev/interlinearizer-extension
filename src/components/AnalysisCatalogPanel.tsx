import { useLocalizedStrings, useSetting } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { X } from 'lucide-react';
import { Button, EmptyState, TooltipProvider } from 'platform-bible-react';
import { formatReplacementString, isPlatformError } from 'platform-bible-utils';
import { useCallback, useMemo, useState } from 'react';
import { useAnalysisLanguage, useCatalogRows } from './AnalysisStore';
import CatalogQueryControls, { QUERY_CONTROL_STRING_KEYS } from './CatalogQueryControls';
import CatalogRowView, { ROW_STRING_KEYS } from './CatalogRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import useRowWindow from '../hooks/useRowWindow';
import {
  applyCatalogQuery,
  deriveFacets,
  reconcileFilters,
  type CatalogFilters,
  type CatalogQuery,
  type CatalogSort,
  type CatalogUsage,
} from '../utils/analysis-query';
import { collatorForTag, languageNameForTag } from '../utils/language-tags';

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per analysis. Hoisted to module scope so the reference passed to `useLocalizedStrings` is
 * stable across renders; a fresh array literal each render makes the PAPI hook re-fetch and re-set
 * state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_analysisCatalog_title%',
  '%interlinearizer_analysisCatalog_close%',
  '%interlinearizer_analysisCatalog_resize%',
  '%interlinearizer_analysisCatalog_empty%',
  '%interlinearizer_analysisCatalog_usageCountInBook%',
  '%interlinearizer_analysisCatalog_noMatches%',
  ...QUERY_CONTROL_STRING_KEYS,
  ...ROW_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link AnalysisCatalogPanel}. */
type AnalysisCatalogPanelProps = Readonly<{
  /** Dismisses the panel. */
  onClose: () => void;
  /** Book code each row's per-book usage count is taken against. */
  currentBook: string;
  /** Whether this project breaks words into morphemes, which the breakdown filter is offered for. */
  showMorphology: boolean;
  /** BCP 47 tag of the source text, so surface forms collate by their own language. */
  sourceLanguageTag: string;
}>;

/**
 * The analysis catalog: every analysis the draft records, listed with the usage data the catalog
 * lists it by. Read-only — nothing here writes to the analysis.
 *
 * Sits beside the interlinear view rather than over it, so a jump to a usage can move the view
 * while the list the jump came from stays on screen.
 */
export default function AnalysisCatalogPanel({
  onClose,
  currentBook,
  showMorphology,
  sourceLanguageTag,
}: AnalysisCatalogPanelProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const analysisLanguage = useAnalysisLanguage();
  const catalogRows = useCatalogRows(currentBook);

  /**
   * What the reader has typed into the search box. Ephemeral rather than persisted: the panel is
   * mounted only while it is open, so closing it clears the query — a filter that outlived a reload
   * would leave rows missing with nothing on screen saying why.
   */
  const [search, setSearch] = useState('');

  /** How the listing is ordered. Most-used first, the question the catalog is opened to answer. */
  const [sort, setSort] = useState<CatalogSort>('usageCount');

  /**
   * Which rows the listing keeps, as the reader last chose them. A choice here can be withdrawn by
   * an edit made beside the panel, so it is the reconciled set below that narrows the listing —
   * while the controls are given these, a withdrawn choice needing to stay on screen to be
   * cleared.
   */
  const [chosenFilters, setFilters] = useState<CatalogFilters>({});

  // Each rebuilt only when its own tag changes: the query around them turns over on every keystroke
  // in the search box, and a collator is expensive enough to be worth not rebuilding that often.
  const surfaceCollator = useMemo(() => collatorForTag(sourceLanguageTag), [sourceLanguageTag]);
  const glossCollator = useMemo(() => collatorForTag(analysisLanguage), [analysisLanguage]);

  /**
   * The choices worth offering as filters, taken against every row the draft holds rather than the
   * rows a filter left standing: a facet judged against its own selection's survivors would
   * collapse to that selection, leaving no choice on screen to widen it back by.
   */
  const facets = useMemo(() => deriveFacets(catalogRows), [catalogRows]);

  /**
   * The filters actually narrowing the listing: the reader's choices less any the facets have since
   * withdrawn. An edit beside the panel can remove the last row carrying a chosen value, which
   * takes that facet's control off screen; keeping the choice would narrow the list to nothing with
   * no control left to widen it back by.
   */
  const filters = useMemo(() => reconcileFilters(chosenFilters, facets), [chosenFilters, facets]);

  /** How the listing is narrowed and ordered, from the controls above the list. */
  const query = useMemo<CatalogQuery>(
    () => ({ search, sort, filters, surfaceCollator, glossCollator }),
    [search, sort, filters, surfaceCollator, glossCollator],
  );

  const rows = useMemo(() => applyCatalogQuery(catalogRows, query), [catalogRows, query]);

  /**
   * The current book's name key, asked for separately from {@link STRING_KEYS} so that changing book
   * re-resolves this alone rather than every string the panel shows.
   */
  const bookNameKeys = useMemo(
    () => [`%LocalizedId.${currentBook}%`] as const satisfies `%${string}%`[],
    [currentBook],
  );
  const [localizedBookName] = useLocalizedStrings(bookNameKeys);

  /**
   * What the current book is called wherever the panel names it in prose. Resolved once and given
   * to every view that names it, so the sort option and the row column cannot name one book two
   * ways.
   *
   * Falls back to the English name, the platform carrying a localized one for only some languages.
   * An unresolved key comes back as itself, which is what distinguishes the two.
   */
  const currentBookName = useMemo(() => {
    const [bookKey] = bookNameKeys;
    const resolved = localizedBookName?.[bookKey];
    return resolved && resolved !== bookKey ? resolved : Canon.bookIdToEnglishName(currentBook);
  }, [localizedBookName, bookNameKeys, currentBook]);

  /**
   * Label every row carries for its per-book usage count, resolved once for the whole list. Names
   * the book rather than giving its code, because this label reads as prose where the usage links
   * below it read as references.
   */
  const usageCountInBookLabel = useMemo(
    () =>
      formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_usageCountInBook%'],
        { book: currentBookName },
      ),
    [localizedStrings, currentBookName],
  );

  const [interfaceLanguages] = useSetting('platform.interfaceLanguage', ['und']);

  /**
   * What the analysis language is called, for the filter that asks after a missing gloss to name it
   * in prose: the question is about a language rather than about a code, and a reader who never
   * chose the tag has no reason to recognize it.
   *
   * Named in the interface's own languages rather than the host's, which the platform's interface
   * language does not follow — a name resolved against the host would read in one language beside a
   * label resolved in another.
   */
  const analysisLanguageName = useMemo(() => {
    /* v8 ignore next -- useSetting never returns PlatformError for this key in practice */
    const locales = isPlatformError(interfaceLanguages) ? undefined : interfaceLanguages;
    return languageNameForTag(analysisLanguage, locales);
  }, [analysisLanguage, interfaceLanguages]);

  /**
   * Everything that decides which listing is on screen. The book counts alongside the query because
   * each row's per-book usage is taken against it: moving to another book reorders a listing sorted
   * by that count, and relabels that column in every other.
   */
  const listing = useMemo(() => ({ query, currentBook }), [query, currentBook]);

  /**
   * The slice of the listing that is actually mounted. A draft accumulates analyses without bound
   * and every row carries its own expander and usage list, so the list grows as it is scrolled
   * rather than rendering whole.
   */
  const { windowRows, scrollRef, sentinelRef } = useRowWindow(rows, listing);

  const { navigate, requestFocusToken } = useInterlinearNav();

  /**
   * The analysis whose usage was last jumped to, or `undefined` before any jump. Marks where in the
   * list the view came from, so a jump that scrolls the text away does not also lose the reader's
   * place in the catalog.
   */
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | undefined>(undefined);

  /**
   * Moves the interlinear view to a usage: the verse it sits in, then the token itself.
   *
   * The focus request is raised before the navigation so that it is already pending when the
   * reference moves. A request is abandoned only once the reference names a book other than the one
   * the request does, so a cross-book jump leaves it outstanding until that book's view mounts and
   * claims it.
   *
   * The navigation is external — the default — because a usage may name any verse in the draft, so
   * the view has to recenter on it rather than track it in place.
   */
  const handleUsageSelect = useCallback(
    (analysisId: string, usage: CatalogUsage) => {
      setSelectedAnalysisId(analysisId);
      requestFocusToken(usage.tokenRef);
      navigate({ book: usage.book, chapterNum: usage.chapter, verseNum: usage.verse });
    },
    [navigate, requestFocusToken],
  );

  return (
    // The panel sits beside the interlinear view rather than within it, so the row tooltips have no
    // enclosing provider to inherit, and a Tooltip without one throws. The delay is irrelevant here:
    // these tooltips open on truncation rather than on hover time.
    <TooltipProvider delayDuration={0}>
      <div
        className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:border-s tw:border-border tw:bg-background"
        data-testid="analysis-catalog-panel"
      >
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-border">
          <h2 className="tw:text-sm tw:font-semibold">
            {localizedStrings['%interlinearizer_analysisCatalog_title%']}
          </h2>
          <Button
            aria-label={localizedStrings['%interlinearizer_analysisCatalog_close%']}
            data-testid="analysis-catalog-close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X className="tw:size-4" />
          </Button>
        </div>

        {/*
          Withheld from a draft that has recorded nothing, where every control would narrow an empty
          listing. Judged against the draft rather than against the rows a query left standing,
          which keeps the controls on screen for the query that matched nothing — they are the only
          way to widen it back.
        */}
        {catalogRows.length > 0 && (
          <CatalogQueryControls
            activeFilters={filters}
            analysisLanguageName={analysisLanguageName}
            currentBookName={currentBookName}
            facets={facets}
            filters={chosenFilters}
            localizedStrings={localizedStrings}
            onFiltersChange={setFilters}
            onSearchChange={setSearch}
            onSortChange={setSort}
            search={search}
            showMorphology={showMorphology}
            sort={sort}
          />
        )}

        {rows.length === 0 ? (
          // Two ways to have nothing to list, and they call for different answers: a draft that has
          // recorded nothing yet, and a query that kept none of what it did. Telling a reader the
          // draft is empty when they have merely mistyped would send them looking for lost work.
          <EmptyState
            className="tw:px-3 tw:py-2"
            id="analysis-catalog-empty"
            message={
              catalogRows.length === 0
                ? localizedStrings['%interlinearizer_analysisCatalog_empty%']
                : localizedStrings['%interlinearizer_analysisCatalog_noMatches%']
            }
          />
        ) : (
          <ul
            className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto"
            ref={scrollRef}
          >
            {windowRows.map((row) => (
              <CatalogRowView
                key={row.analysisId}
                analysisLanguage={analysisLanguage}
                isSelected={row.analysisId === selectedAnalysisId}
                localizedStrings={localizedStrings}
                onUsageSelect={handleUsageSelect}
                row={row}
                usageCountInBookLabel={usageCountInBookLabel}
              />
            ))}
            {/*
              Sits after the last mounted row, so reaching it means the reader has scrolled to the
              end of what is mounted rather than to the end of the listing. A list item rather than a
              bare div, since a `ul` may hold nothing else.
            */}
            <li aria-hidden data-testid="catalog-rows-sentinel" ref={sentinelRef} />
          </ul>
        )}
      </div>
    </TooltipProvider>
  );
}
