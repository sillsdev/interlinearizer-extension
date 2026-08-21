import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { X } from 'lucide-react';
import { Button, EmptyState } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useAnalysisLanguage, useCatalogRows } from './AnalysisStore';
import CatalogQueryControls, { QUERY_CONTROL_STRING_KEYS } from './CatalogQueryControls';
import CatalogRowView, { ROW_STRING_KEYS } from './CatalogRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import useContainerWidth from '../hooks/useContainerWidth';
import usePanelResize, { type PanelWidthBounds } from '../hooks/usePanelResize';
import useRowWindow from '../hooks/useRowWindow';
import {
  applyCatalogQuery,
  deriveFacets,
  type CatalogFilters,
  type CatalogQuery,
  type CatalogSort,
  type CatalogUsage,
} from '../utils/analysis-query';
import { collatorForTag } from '../utils/language-tags';

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

/**
 * How far the panel may be resized on its own account: from narrow enough that the usage counts
 * still fit to wide enough to read a gloss whole. A container with no room for the wide end gives
 * the panel less than this — see {@link MIN_VIEW_WIDTH_PX}.
 */
const WIDTH_BOUNDS: PanelWidthBounds = { min: 220, max: 800 };

/**
 * How much of the container the interlinear view keeps whatever width the panel is asked for, in
 * pixels. The panel sits beside the text rather than over it, so a container too narrow for both at
 * their full width narrows the panel rather than pushing the text off the screen — unless it has no
 * room for this and the narrowest panel together.
 */
const MIN_VIEW_WIDTH_PX = 240;

/**
 * How far a panel in a container this wide may be resized: {@link WIDTH_BOUNDS}, its wide end held
 * to the room {@link MIN_VIEW_WIDTH_PX} leaves. A container of unknown width — one nothing has laid
 * out yet — constrains nothing.
 */
function boundsWithin(containerWidth: number | undefined): PanelWidthBounds {
  if (containerWidth === undefined) return WIDTH_BOUNDS;
  return {
    min: WIDTH_BOUNDS.min,
    max: Math.max(WIDTH_BOUNDS.min, Math.min(WIDTH_BOUNDS.max, containerWidth - MIN_VIEW_WIDTH_PX)),
  };
}

/** Props for {@link AnalysisCatalogPanel}. */
type AnalysisCatalogPanelProps = Readonly<{
  /** Dismisses the panel. */
  onClose: () => void;
  /** The panel's committed width in pixels. */
  width: number;
  /**
   * Records a new committed width. Called once a drag is released rather than per frame: the width
   * is persisted, and a write per mouse move would put the whole drag through the host.
   */
  onWidthChange: (width: number) => void;
  /** Book code each row's per-book usage count is taken against. */
  currentBook: string;
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
  width,
  onWidthChange,
  currentBook,
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

  /** Which rows the listing keeps. Nothing narrowed until the reader chooses something. */
  const [filters, setFilters] = useState<CatalogFilters>({});

  /** How the listing is narrowed and ordered, from the controls above the list. */
  const query = useMemo<CatalogQuery>(
    () => ({
      search,
      sort,
      filters,
      surfaceCollator: collatorForTag(sourceLanguageTag),
      glossCollator: collatorForTag(analysisLanguage),
    }),
    [search, sort, filters, sourceLanguageTag, analysisLanguage],
  );

  const rows = useMemo(() => applyCatalogQuery(catalogRows, query), [catalogRows, query]);

  /**
   * What the current book is called wherever the panel names it in prose. Its English name rather
   * than its code, because prose naming a book by code reads as a reference, which is what the
   * usage links are. A platform-localized name would need PAPI wiring this view does not yet have.
   */
  const currentBookName = useMemo(() => Canon.bookIdToEnglishName(currentBook), [currentBook]);

  /** Label every row carries for its per-book usage count, resolved once for the whole list. */
  const usageCountInBookLabel = useMemo(
    () =>
      formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_usageCountInBook%'],
        { book: currentBookName },
      ),
    [localizedStrings, currentBookName],
  );

  /**
   * The choices worth offering as filters, taken against every row the draft holds rather than the
   * rows a filter left standing: a facet judged against its own selection's survivors would
   * collapse to that selection, leaving no choice on screen to widen it back by.
   */
  const facets = useMemo(() => deriveFacets(catalogRows), [catalogRows]);

  /**
   * The slice of the listing that is actually mounted. A draft accumulates analyses without bound
   * and every row carries its own expander and usage list, so the list grows as it is scrolled
   * rather than rendering whole.
   */
  const { windowRows, scrollRef, sentinelRef } = useRowWindow(rows);

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

  /** The panel itself, so the room its container leaves for the view can be measured. */
  // eslint-disable-next-line no-null/no-null
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useContainerWidth(panelRef);
  const bounds = boundsWithin(containerWidth);

  const {
    displayWidth,
    onMouseDown: handleResizeMouseDown,
    onKeyDown: handleResizeKeyDown,
  } = usePanelResize(width, onWidthChange, bounds);

  return (
    <div
      ref={panelRef}
      className="tw:flex tw:min-h-0 tw:shrink-0 tw:border-s tw:border-border tw:bg-background"
      data-testid="analysis-catalog-panel"
      style={{ width: displayWidth }}
    >
      {/*
        The ARIA window-splitter pattern: a focusable `separator` carrying the width it controls as
        its value, driven by drag or by arrow key. jsx-a11y reads `separator` as non-interactive and
        objects to both the listeners and the tab stop, but a splitter is exactly the case where the
        role is focusable and operable — an unfocusable one would be resizable by mouse only.
      */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        aria-label={localizedStrings['%interlinearizer_analysisCatalog_resize%']}
        aria-orientation="vertical"
        aria-valuemax={bounds.max}
        aria-valuemin={bounds.min}
        aria-valuenow={displayWidth}
        className="tw:w-1 tw:shrink-0 tw:cursor-col-resize tw:hover:bg-accent"
        data-testid="analysis-catalog-resize"
        onKeyDown={handleResizeKeyDown}
        onMouseDown={handleResizeMouseDown}
        role="separator"
        tabIndex={0}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0">
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

        <CatalogQueryControls
          analysisLanguage={analysisLanguage}
          currentBookName={currentBookName}
          facets={facets}
          filters={filters}
          localizedStrings={localizedStrings}
          onFiltersChange={setFilters}
          onSearchChange={setSearch}
          onSortChange={setSort}
          search={search}
          sort={sort}
        />

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
    </div>
  );
}
