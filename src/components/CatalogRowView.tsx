import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTruncationTooltip,
} from 'platform-bible-react';
import { formatReplacementString, formatScrRef, type LanguageStrings } from 'platform-bible-utils';
import { memo, useCallback, useState } from 'react';
import CatalogRowEditor, { ROW_EDITOR_STRING_KEYS } from './CatalogRowEditor';
import type { CatalogRow, CatalogUsage } from '../utils/analysis-query';
import { resolvedOrEmpty } from '../utils/localized-strings';

/**
 * Localized string keys a row renders. Every row asks for the same strings, and subscribing per row
 * would be a subscription per analysis in the draft, so they are resolved above the list and handed
 * down.
 */
export const ROW_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_usageCount%',
  '%interlinearizer_analysisCatalog_noUsages%',
  '%interlinearizer_analysisCatalog_showAllUsages%',
  ...ROW_EDITOR_STRING_KEYS,
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
  /** Writes this row's gloss for every token linked to it. */
  onGlossCommit: (analysisId: string, value: string) => void;
  /** Replaces this row's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (analysisId: string, forms: readonly string[]) => void;
  /** Writes one of this row's morpheme glosses for every token linked to it. */
  onMorphemeGlossCommit: (analysisId: string, morphemeId: string, value: string) => void;
  /**
   * Opens the merge picker for this row. Absent when the analysis has no pool peers, which is how
   * the merge control is withheld from a row with nothing to merge into.
   */
  onMergeRequest?: (analysisId: string) => void;
  /** Opens the delete confirmation for this row. */
  onDeleteRequest: (analysisId: string) => void;
  /**
   * Whether the row should be scrolled into view. Set on the row a merge-on-edit left standing, so
   * the reader is taken to where their edit went rather than left where it vanished from.
   */
  shouldRevealSelf?: boolean;
  /** This row's breakdown draft, or `undefined` while its breakdown editor is closed. */
  breakdownDraft: string | undefined;
  /** Records this row's breakdown draft, `undefined` closing its breakdown editor. */
  onBreakdownDraftChange: (analysisId: string, draft: string | undefined) => void;
}>;

/** Renders a usage's location the way scripture references are written, e.g. `GEN 1:1`. */
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
  onUsageSelect,
  localizedStrings,
  analysisLanguage,
  onGlossCommit,
  onMorphemesCommit,
  onMorphemeGlossCommit,
  onMergeRequest,
  onDeleteRequest,
  shouldRevealSelf = false,
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
  const handleBreakdownDraftChange = useCallback(
    (draft: string | undefined) => onBreakdownDraftChange(analysisId, draft),
    [analysisId, onBreakdownDraftChange],
  );

  const visibleUsages = showsAllUsages ? row.usages : row.usages.slice(0, INLINE_USAGE_LIMIT);
  const hiddenUsageCount = row.usages.length - visibleUsages.length;

  const usageCountLabel = localizedStrings['%interlinearizer_analysisCatalog_usageCount%'];

  // This is visible cell text, so blanking an unresolved key would empty the gloss column. The em
  // dash reads as "no gloss" in any language and stands in until the lookup lands.
  const glossLabel =
    row.gloss ||
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) ||
    '—';

  // One tooltip each rather than one for the row: either column may be the clipped one, and a
  // tooltip is worth opening only over the text that is actually cut off.
  const surfaceTooltip = useTruncationTooltip<HTMLSpanElement>();
  const glossTooltip = useTruncationTooltip<HTMLSpanElement>();

  /**
   * Brings the row into view once the panel asks for it, which it does for the row a merge-on-edit
   * left standing. Runs on the flag turning true rather than on every render, so a reader who then
   * scrolls away is not dragged back by an unrelated re-render.
   */
  const revealRef = useCallback(
    (el: HTMLLIElement | null) => {
      /* v8 ignore next -- jsdom implements no layout, so scrollIntoView is absent on the element */
      if (shouldRevealSelf) el?.scrollIntoView?.({ block: 'nearest' });
    },
    [shouldRevealSelf],
  );

  return (
    <li
      ref={revealRef}
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
        <Tooltip open={surfaceTooltip.open}>
          <TooltipTrigger asChild>
            <span
              ref={surfaceTooltip.ref}
              className="tw:flex-1 tw:min-w-0 tw:truncate tw:font-medium"
              data-testid="catalog-row-surface"
              onPointerEnter={surfaceTooltip.onPointerEnter}
              onPointerLeave={surfaceTooltip.onPointerLeave}
            >
              {row.surfaceText}
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.surfaceText}</TooltipContent>
        </Tooltip>
        <Tooltip open={glossTooltip.open}>
          <TooltipTrigger asChild>
            <span
              ref={glossTooltip.ref}
              className="tw:flex-1 tw:min-w-0 tw:truncate tw:text-sm tw:text-muted-foreground"
              data-testid="catalog-row-gloss"
              onPointerEnter={glossTooltip.onPointerEnter}
              onPointerLeave={glossTooltip.onPointerLeave}
            >
              {glossLabel}
            </span>
          </TooltipTrigger>
          <TooltipContent>{glossLabel}</TooltipContent>
        </Tooltip>
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
          <CatalogRowEditor
            analysisId={row.analysisId}
            analysisLanguage={analysisLanguage}
            breakdownDraft={breakdownDraft}
            gloss={row.gloss}
            localizedStrings={localizedStrings}
            morphemes={row.morphemes}
            onBreakdownDraftChange={handleBreakdownDraftChange}
            onDeleteRequest={handleDeleteRequest}
            onGlossCommit={handleGlossCommit}
            onMergeRequest={onMergeRequest ? handleMergeRequest : undefined}
            onMorphemeGlossCommit={handleMorphemeGlossCommit}
            onMorphemesCommit={handleMorphemesCommit}
            surfaceText={row.surfaceText}
          />

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
