import { Button } from 'platform-bible-react';
import { formatReplacementString, formatScrRef, type LanguageStrings } from 'platform-bible-utils';
import { memo, useCallback, useState } from 'react';
import CatalogRowEditor, { CatalogRowActions, ROW_EDITOR_STRING_KEYS } from './CatalogRowEditor';
import CatalogRowHeader, { ROW_HEADER_STRING_KEYS } from './CatalogRowHeader';
import CatalogStaleLocations, { STALE_LOCATION_STRING_KEYS } from './CatalogStaleLocations';
import type { CatalogRow, CatalogUsage } from '../utils/analysis-query';

/**
 * Localized string keys a row renders. Every row asks for the same strings, and subscribing per row
 * would be a subscription per analysis in the draft, so they are resolved above the list and handed
 * down.
 */
export const ROW_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_noUsages%',
  '%interlinearizer_analysisCatalog_showAllUsages%',
  ...ROW_HEADER_STRING_KEYS,
  ...ROW_EDITOR_STRING_KEYS,
  ...STALE_LOCATION_STRING_KEYS,
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
  /** Whether this row is among those a bulk action applies to. */
  isChecked: boolean;
  /**
   * Adds this row to, or takes it out of, the rows a bulk action applies to. Absent for a read-only
   * analysis, which no bulk action applies to.
   */
  onCheckedChange?: (analysisId: string, checked: boolean) => void;
  /** Jumps the interlinear view to one of this analysis's usages. */
  onUsageSelect: (analysisId: string, usage: CatalogUsage) => void;
  /** Moves the interlinear view to the verse of a place this analysis went stale at. */
  onStaleSelect: (analysisId: string, location: CatalogUsage) => void;
  /** Gives up a place this analysis went stale at. */
  onStaleDiscard: (analysisId: string, location: CatalogUsage) => void;
  /** Moves this analysis from a place it went stale at onto the token at `tokenRef`. */
  onStaleReapply: (
    analysisId: string,
    location: CatalogUsage,
    tokenRef: string,
    surfaceText: string,
  ) => void;
  /** Reads the loaded book's current text for a token ref, `undefined` for one in any other book. */
  liveSurfaceText: (tokenRef: string) => string | undefined;
  /** Resolved localizations covering at least {@link ROW_STRING_KEYS}, shared by the whole list. */
  localizedStrings: LanguageStrings;
  /** BCP 47 tag the morpheme glosses are read under. */
  analysisLanguage: string;
  /** When false, the row's breakdown is not shown, as the view option hides it on the strip. */
  showMorphology: boolean;
  /** Writes this row's gloss for every token linked to it. */
  onGlossCommit: (analysisId: string, value: string) => void;
  /** Replaces this row's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (analysisId: string, forms: readonly string[]) => void;
  /** Writes one of this row's morpheme glosses for every token linked to it. */
  onMorphemeGlossCommit: (analysisId: string, morphemeId: string, value: string) => void;
  /**
   * Opens the merge picker for this row. Absent when the analysis shares its form with no other
   * record, which is how the merge control is withheld from a row with nothing to merge with.
   */
  onMergeRequest?: (analysisId: string) => void;
  /** Asks for this row's analysis to be deleted. */
  onDeleteRequest: (analysisId: string) => void;
  /** Asks for the row to be scrolled into view, each new value asking again. */
  revealRequest?: object;
  /** This row's breakdown draft, or `undefined` while its breakdown editor is closed. */
  breakdownDraft: string | undefined;
  /**
   * Records this row's breakdown draft, `undefined` closing its breakdown editor. Reports the
   * analysis's surface form alongside it, which names the draft once its record is gone.
   */
  onBreakdownDraftChange: (
    analysisId: string,
    draft: string | undefined,
    surfaceText: string,
  ) => void;
}>;

/** Renders a place's verse the way scripture references are written, e.g. `GEN 1:1`. */
function usageLabel(usage: CatalogUsage): string {
  return formatScrRef({
    book: usage.book,
    chapterNum: usage.chapter,
    verseNum: usage.verse,
  });
}

/**
 * One analysis in the catalog: its surface form and gloss, and how much of the draft it accounts
 * for — the whole draft's usage count beside the current book's. Expanding it reveals the controls
 * for editing the analysis and the places it is applied.
 *
 * Each row owns its own layout so that its detail can be nested inside it.
 */
function CatalogRowView({
  row,
  usageCountInBookLabel,
  isSelected,
  isChecked,
  onCheckedChange,
  onUsageSelect,
  onStaleSelect,
  onStaleDiscard,
  onStaleReapply,
  liveSurfaceText,
  localizedStrings,
  analysisLanguage,
  showMorphology,
  onGlossCommit,
  onMorphemesCommit,
  onMorphemeGlossCommit,
  onMergeRequest,
  onDeleteRequest,
  revealRequest,
  breakdownDraft,
  onBreakdownDraftChange,
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

  // The editor is handed callbacks already carrying this row's id, so it never needs the id itself
  // to report an edit.
  const { analysisId } = row;
  const handleGlossCommit = useCallback(
    (value: string) => onGlossCommit(analysisId, value),
    [analysisId, onGlossCommit],
  );
  const handleMorphemesCommit = useCallback(
    (forms: readonly string[]) => onMorphemesCommit(analysisId, forms),
    [analysisId, onMorphemesCommit],
  );
  const handleMorphemeGlossCommit = useCallback(
    (morphemeId: string, value: string) => onMorphemeGlossCommit(analysisId, morphemeId, value),
    [analysisId, onMorphemeGlossCommit],
  );
  const handleMergeRequest = useCallback(
    () => onMergeRequest?.(analysisId),
    [analysisId, onMergeRequest],
  );
  const handleDeleteRequest = useCallback(
    () => onDeleteRequest(analysisId),
    [analysisId, onDeleteRequest],
  );
  const handleStaleSelect = useCallback(
    (location: CatalogUsage) => onStaleSelect(analysisId, location),
    [analysisId, onStaleSelect],
  );
  const handleStaleDiscard = useCallback(
    (location: CatalogUsage) => onStaleDiscard(analysisId, location),
    [analysisId, onStaleDiscard],
  );
  const handleStaleReapply = useCallback(
    (location: CatalogUsage, tokenRef: string, targetSurfaceText: string) =>
      onStaleReapply(analysisId, location, tokenRef, targetSurfaceText),
    [analysisId, onStaleReapply],
  );
  const { surfaceText } = row;
  const handleBreakdownDraftChange = useCallback(
    (draft: string | undefined) => onBreakdownDraftChange(analysisId, draft, surfaceText),
    [analysisId, onBreakdownDraftChange, surfaceText],
  );

  const visibleUsages = showsAllUsages ? row.usages : row.usages.slice(0, INLINE_USAGE_LIMIT);
  const hiddenUsageCount = row.usages.length - visibleUsages.length;

  /**
   * Scrolls the row into view each time `revealRequest` takes a new value, so a re-render that
   * leaves it unchanged never drags a reader back.
   */
  const revealRef = useCallback(
    (el: HTMLLIElement | null) => {
      /* v8 ignore next -- jsdom implements no layout, so scrollIntoView is absent on the element */
      if (revealRequest) el?.scrollIntoView?.({ block: 'nearest' });
    },
    [revealRequest],
  );

  return (
    <li
      ref={revealRef}
      className={`tw:col-span-full tw:grid tw:grid-cols-subgrid tw:border-b tw:border-border ${
        isSelected ? 'tw:bg-accent/50' : ''
      }`}
      data-analysis-id={row.analysisId}
      data-selected={String(isSelected)}
      data-testid="catalog-row"
    >
      <CatalogRowHeader
        isChecked={isChecked}
        isExpanded={isExpanded}
        localizedStrings={localizedStrings}
        onCheckedChange={onCheckedChange}
        onToggle={handleToggle}
        row={row}
        usageCountInBookLabel={usageCountInBookLabel}
      />

      {isExpanded && (
        <div
          className="tw:col-span-full tw:flex tw:flex-col tw:gap-2 tw:px-3 tw:pb-2 tw:ps-8"
          data-testid="catalog-row-detail"
        >
          <CatalogRowEditor
            analysisId={row.analysisId}
            analysisLanguage={analysisLanguage}
            breakdownDraft={breakdownDraft}
            gloss={row.gloss}
            localizedStrings={localizedStrings}
            morphemes={row.morphemes}
            morphemesStale={row.morphemesStale}
            showMorphology={showMorphology}
            onBreakdownDraftChange={handleBreakdownDraftChange}
            onGlossCommit={handleGlossCommit}
            onMorphemeGlossCommit={handleMorphemeGlossCommit}
            onMorphemesCommit={handleMorphemesCommit}
            surfaceText={row.surfaceText}
            usageCount={row.usageCount}
          />

          {row.usages.length === 0 && row.staleLocations.length === 0 && (
            <p className="tw:text-xs tw:text-muted-foreground">
              {localizedStrings['%interlinearizer_analysisCatalog_noUsages%']}
            </p>
          )}
          {row.usages.length > 0 && (
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

          {row.staleLocations.length > 0 && (
            <CatalogStaleLocations
              inlineLimit={INLINE_USAGE_LIMIT}
              labelFor={usageLabel}
              liveSurfaceText={liveSurfaceText}
              localizedStrings={localizedStrings}
              locations={row.staleLocations}
              onDiscard={handleStaleDiscard}
              onReapply={handleStaleReapply}
              onSelect={handleStaleSelect}
            />
          )}

          {/* Below the usages, so what a merge or delete is about to take is in view above the
              button taking it. */}
          <CatalogRowActions
            localizedStrings={localizedStrings}
            onDeleteRequest={handleDeleteRequest}
            onMergeRequest={onMergeRequest ? handleMergeRequest : undefined}
          />
        </div>
      )}
    </li>
  );
}

/** Memoized version of {@link CatalogRowView}; use in render-stable row lists. */
const MemoizedCatalogRowView = memo(CatalogRowView);
export default MemoizedCatalogRowView;
