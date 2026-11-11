import type { SenseCandidate } from 'interlinearizer/lexicon';
import { Button } from 'platform-bible-react';
import { formatReplacementString, formatScrRef, type LanguageStrings } from 'platform-bible-utils';
import { memo, useCallback, useRef, useState } from 'react';
import CatalogRowEditor, {
  CatalogRowActions,
  type GlossRetry,
  ROW_EDITOR_STRING_KEYS,
} from './CatalogRowEditor';
import CatalogRowHeader, { ROW_HEADER_STRING_KEYS } from './CatalogRowHeader';
import CatalogStaleLocations, { STALE_LOCATION_STRING_KEYS } from './CatalogStaleLocations';
import type { CatalogRow, CatalogUsage } from '../utils/analysis-query';
import type { Settles } from '../utils/settles';

/**
 * Localized string keys a row renders. Every row asks for the same strings, and subscribing per row
 * would be a subscription per analysis in the draft, so they are resolved above the list and handed
 * down.
 */
export const ROW_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_noUsages%',
  '%interlinearizer_analysisCatalog_showAllUsages%',
  '%interlinearizer_analysisCatalog_showFewerUsages%',
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
  /** Whether the source text, as last read, holds this analysis's form nowhere. */
  isNotInText: boolean;
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
  /** BCP 47 tag the row's glosses are read under. */
  analysisLanguage: string;
  /** When false, the row's breakdown is not shown, as the view option hides it on the strip. */
  showMorphology: boolean;
  /**
   * Writes this row's gloss for every token linked to it. A result that rejects leaves the edit
   * unsent, for the field to send again.
   */
  onGlossCommit: (analysisId: string, value: string) => Settles<unknown>;
  /** Replaces this row's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (analysisId: string, forms: readonly string[]) => void;
  /** Keeps this row's stale breakdown as it stands, for every token linked to it. */
  onMorphemesConfirm: (analysisId: string) => void;
  /**
   * Writes one of this row's morpheme glosses for every token linked to it. A result that rejects
   * leaves the edit unsent, for the field to send again.
   */
  onMorphemeGlossCommit: (
    analysisId: string,
    morphemeId: string,
    value: string,
  ) => Settles<unknown>;
  /** Links this row's analysis to the picked lexicon sense, replacing any link. */
  onLinkSense: (analysisId: string, candidate: SenseCandidate) => void;
  /** Drops this row's sense link; `keepGloss` is the sense gloss to keep as its typed gloss. */
  onUnlinkSense: (analysisId: string, keepGloss?: string) => void;
  /** Writes the sense this row links to as its typed gloss. */
  onAdoptSenseGloss: (analysisId: string, senseGloss: string) => void;
  /** Links one of this row's morphemes to the picked lexicon sense, replacing any link. */
  onLinkMorphemeSense: (analysisId: string, morphemeId: string, candidate: SenseCandidate) => void;
  /** Drops a morpheme's sense link; `keepGloss` is the sense gloss to keep as its typed gloss. */
  onUnlinkMorphemeSense: (analysisId: string, morphemeId: string, keepGloss?: string) => void;
  /** Writes the sense a morpheme links to as its typed gloss. */
  onAdoptMorphemeSenseGloss: (analysisId: string, morphemeId: string, senseGloss: string) => void;
  /**
   * Opens the merge picker for this row. Absent when the analysis shares its form with no other
   * record, which is how the merge control is withheld from a row with nothing to merge with.
   */
  onMergeRequest?: (analysisId: string) => void;
  /** Deletes this row's analysis. Called only after the reader confirms the deletion. */
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
  /** Keeps the gloss drafts no field is showing, and tracks the fields showing a failed one. */
  glossRetry: GlossRetry;
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
  isNotInText,
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
  onMorphemesConfirm,
  onMorphemeGlossCommit,
  onLinkSense,
  onUnlinkSense,
  onAdoptSenseGloss,
  onLinkMorphemeSense,
  onUnlinkMorphemeSense,
  onAdoptMorphemeSenseGloss,
  onMergeRequest,
  onDeleteRequest,
  revealRequest,
  breakdownDraft,
  onBreakdownDraftChange,
  glossRetry,
}: CatalogRowViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  /** Whether the usage list is showing every usage rather than the first {@link INLINE_USAGE_LIMIT}. */
  const [showsAllUsages, setShowsAllUsages] = useState(false);

  /**
   * Whether the Show N more link takes focus when it next mounts.
   *
   * Show fewer sets this flag, because Show fewer unmounts itself when clicked. Focusing the link
   * keeps keyboard focus in the row. The browser also scrolls the row back into view.
   */
  const focusShowAllOnMountRef = useRef(false);
  const showAllRef = useCallback((el: HTMLButtonElement | null) => {
    if (!el || !focusShowAllOnMountRef.current) return;
    focusShowAllOnMountRef.current = false;
    el.focus();
  }, []);
  const handleShowFewer = useCallback(() => {
    focusShowAllOnMountRef.current = true;
    setShowsAllUsages(false);
  }, []);

  // Collapsing returns the row to the inline cap, so a row reopened later does not bury the rows
  // beneath it.
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
  const handleMorphemesConfirm = useCallback(
    () => onMorphemesConfirm(analysisId),
    [analysisId, onMorphemesConfirm],
  );
  const handleMorphemeGlossCommit = useCallback(
    (morphemeId: string, value: string) => onMorphemeGlossCommit(analysisId, morphemeId, value),
    [analysisId, onMorphemeGlossCommit],
  );
  const handleLinkSense = useCallback(
    (candidate: SenseCandidate) => onLinkSense(analysisId, candidate),
    [analysisId, onLinkSense],
  );
  const handleUnlinkSense = useCallback(
    (keepGloss?: string) => onUnlinkSense(analysisId, keepGloss),
    [analysisId, onUnlinkSense],
  );
  const handleAdoptSenseGloss = useCallback(
    (senseGloss: string) => onAdoptSenseGloss(analysisId, senseGloss),
    [analysisId, onAdoptSenseGloss],
  );
  const handleLinkMorphemeSense = useCallback(
    (morphemeId: string, candidate: SenseCandidate) =>
      onLinkMorphemeSense(analysisId, morphemeId, candidate),
    [analysisId, onLinkMorphemeSense],
  );
  const handleUnlinkMorphemeSense = useCallback(
    (morphemeId: string, keepGloss?: string) =>
      onUnlinkMorphemeSense(analysisId, morphemeId, keepGloss),
    [analysisId, onUnlinkMorphemeSense],
  );
  const handleAdoptMorphemeSenseGloss = useCallback(
    (morphemeId: string, senseGloss: string) =>
      onAdoptMorphemeSenseGloss(analysisId, morphemeId, senseGloss),
    [analysisId, onAdoptMorphemeSenseGloss],
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
        analysisLanguage={analysisLanguage}
        isChecked={isChecked}
        isExpanded={isExpanded}
        isNotInText={isNotInText}
        localizedStrings={localizedStrings}
        onAdoptSenseGloss={handleAdoptSenseGloss}
        onCheckedChange={onCheckedChange}
        onLinkSense={handleLinkSense}
        onToggle={handleToggle}
        onUnlinkSense={handleUnlinkSense}
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
            glossRetry={glossRetry}
            gloss={row.gloss}
            glossSenseRef={row.glossSenseRef}
            localizedStrings={localizedStrings}
            morphemes={row.morphemes}
            morphemesStale={row.morphemesStale}
            showMorphology={showMorphology}
            onAdoptMorphemeSenseGloss={handleAdoptMorphemeSenseGloss}
            onBreakdownDraftChange={handleBreakdownDraftChange}
            onGlossCommit={handleGlossCommit}
            onLinkMorphemeSense={handleLinkMorphemeSense}
            onMorphemeGlossCommit={handleMorphemeGlossCommit}
            onMorphemesCommit={handleMorphemesCommit}
            onMorphemesConfirm={handleMorphemesConfirm}
            onUnlinkMorphemeSense={handleUnlinkMorphemeSense}
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
                  ref={showAllRef}
                  size="sm"
                  variant="link"
                >
                  {formatReplacementString(
                    localizedStrings['%interlinearizer_analysisCatalog_showAllUsages%'],
                    { count: hiddenUsageCount },
                  )}
                </Button>
              )}
              {showsAllUsages && row.usages.length > INLINE_USAGE_LIMIT && (
                <Button
                  data-testid="catalog-usages-show-fewer"
                  onClick={handleShowFewer}
                  size="sm"
                  variant="link"
                >
                  {localizedStrings['%interlinearizer_analysisCatalog_showFewerUsages%']}
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
            surfaceText={row.surfaceText}
          />
        </div>
      )}
    </li>
  );
}

/** Memoized version of {@link CatalogRowView}; use in render-stable row lists. */
const MemoizedCatalogRowView = memo(CatalogRowView);
export default MemoizedCatalogRowView;
