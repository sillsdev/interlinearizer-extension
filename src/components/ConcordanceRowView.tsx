import type { TokenAnalysis } from 'interlinearizer';
import { ChevronDown, ChevronRight, Circle, CircleCheck, CircleDashed } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTruncationTooltip,
} from 'platform-bible-react';
import { formatReplacementString, formatScrRef, type LanguageStrings } from 'platform-bible-utils';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  contextLine,
  tallyAnalyses,
  type ConcordanceOccurrence,
  type ConcordanceRow,
  type ConcordanceStatus,
} from '../utils/concordance';

/**
 * Localized string keys a row renders, resolved above the list and handed down so the list asks
 * once rather than once per form.
 */
export const CONCORDANCE_ROW_STRING_KEYS = [
  '%interlinearizer_concordance_occurrenceCount%',
  '%interlinearizer_concordance_status_analyzed%',
  '%interlinearizer_concordance_status_partlyAnalyzed%',
  '%interlinearizer_concordance_status_unanalyzed%',
  '%interlinearizer_concordance_noGloss%',
  '%interlinearizer_concordance_unanalyzed%',
  '%interlinearizer_concordance_showMoreOccurrences%',
] as const satisfies `%${string}%`[];

/**
 * How many occurrences an expanded row lists before the rest go behind an expander. A common word
 * occurs thousands of times; listing them all would bury every row beneath it.
 */
const INLINE_OCCURRENCE_LIMIT = 12;

/**
 * How many more occurrences each use of the expander lists. Paged rather than all at once: the
 * commonest words occur tens of thousands of times, more than the panel can mount without
 * stalling.
 */
const OCCURRENCE_PAGE_SIZE = 100;

/** The label naming each status, for readers who cannot tell the icons apart. */
const STATUS_LABEL_KEYS = {
  analyzed: '%interlinearizer_concordance_status_analyzed%',
  partlyAnalyzed: '%interlinearizer_concordance_status_partlyAnalyzed%',
  unanalyzed: '%interlinearizer_concordance_status_unanalyzed%',
} as const satisfies Record<ConcordanceStatus, (typeof CONCORDANCE_ROW_STRING_KEYS)[number]>;

/** Tells the statuses apart by shape. */
const STATUS_ICONS = {
  analyzed: CircleCheck,
  partlyAnalyzed: CircleDashed,
  unanalyzed: Circle,
} as const satisfies Record<ConcordanceStatus, unknown>;

/** Props for {@link ConcordanceRowView}. */
type ConcordanceRowViewProps = Readonly<{
  row: ConcordanceRow;
  /** Finished label for `row.occurrenceCountInBook`, naming the book that count was taken in. */
  occurrenceCountInBookLabel: string;
  /** Whether this is the row the view was last jumped from. */
  isSelected: boolean;
  /** Jumps the interlinear view to one of this form's occurrences. */
  onOccurrenceSelect: (form: string, occurrence: ConcordanceOccurrence) => void;
  /** Resolved localizations covering at least {@link CONCORDANCE_ROW_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** The approved analysis of each token that has one, by token ref. */
  approvedByToken: ReadonlyMap<string, string>;
  /** Every token analysis on record, by id. */
  analysesById: ReadonlyMap<string, TokenAnalysis>;
  /** BCP 47 tag the glosses are read in. */
  analysisLanguage: string;
  /** BCP 47 tag of the source text, so the form and its context render as that language. */
  sourceLanguageTag: string;
}>;

/** Renders an occurrence's location the way scripture references are written, e.g. `GEN 1:1`. */
function occurrenceLabel(occurrence: ConcordanceOccurrence): string {
  return formatScrRef({
    book: occurrence.book,
    chapterNum: occurrence.chapter,
    verseNum: occurrence.verse,
  });
}

/** Props for {@link ContextLineView}. */
type ContextLineViewProps = Readonly<{
  occurrence: ConcordanceOccurrence;
  sourceLanguageTag: string;
}>;

/**
 * An occurrence within its verse, the form held in the middle of the line: the text ahead of it
 * gives way at its far edge and the text after it at its own, so a narrow panel still shows the
 * form and the words nearest it.
 */
function ContextLineView({ occurrence, sourceLanguageTag }: ContextLineViewProps) {
  const line = contextLine(occurrence);
  // The line preserves whitespace so the gaps beside the form survive, which a line break must not.
  const flatten = (text: string) => text.replace(/\s+/g, ' ');
  return (
    <span
      className="tw:flex tw:flex-1 tw:min-w-0 tw:whitespace-pre"
      data-testid="concordance-context"
      dir="auto"
      lang={sourceLanguageTag}
    >
      {/* Packed against the form, so what overflows is the far end of the leading text. */}
      <span className="tw:flex tw:flex-1 tw:min-w-0 tw:justify-end tw:overflow-hidden">
        <span>{`${line.clippedBefore ? '…' : ''}${flatten(line.before)}`}</span>
      </span>
      <mark className="tw:shrink-0 tw:bg-transparent tw:font-semibold tw:text-foreground">
        {line.form}
      </mark>
      <span className="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-start">
        {`${flatten(line.after)}${line.clippedAfter ? '…' : ''}`}
      </span>
    </span>
  );
}

/**
 * One form in the concordance: how often it occurs, in the whole text and in the current book, and
 * how much of that is analyzed. Expanding it shows which analyses its occurrences carry and lists
 * the occurrences themselves, each in its verse.
 */
function ConcordanceRowView({
  row,
  occurrenceCountInBookLabel,
  isSelected,
  onOccurrenceSelect,
  localizedStrings,
  approvedByToken,
  analysesById,
  analysisLanguage,
  sourceLanguageTag,
}: ConcordanceRowViewProps) {
  const { entry, status } = row;
  const [isExpanded, setIsExpanded] = useState(false);

  const [shownCount, setShownCount] = useState(INLINE_OCCURRENCE_LIMIT);

  // Collapsing returns the row to the inline cap, so a row paged deep into its occurrences reopens
  // short rather than mounting them all again.
  const handleToggle = useCallback(() => {
    setIsExpanded((expanded) => !expanded);
    setShownCount(INLINE_OCCURRENCE_LIMIT);
  }, []);

  const tallies = useMemo(
    () => (isExpanded ? tallyAnalyses(entry, approvedByToken, analysesById, analysisLanguage) : []),
    [isExpanded, entry, approvedByToken, analysesById, analysisLanguage],
  );
  const glossByAnalysisId = useMemo(
    () => new Map(tallies.map((t) => [t.analysisId, t.gloss])),
    [tallies],
  );

  const noGloss = localizedStrings['%interlinearizer_concordance_noGloss%'];
  const unanalyzedLabel = localizedStrings['%interlinearizer_concordance_unanalyzed%'];
  const occurrenceCountLabel = localizedStrings['%interlinearizer_concordance_occurrenceCount%'];
  const statusLabel = localizedStrings[STATUS_LABEL_KEYS[status]];
  const StatusIcon = STATUS_ICONS[status];
  const unanalyzedCount = entry.occurrences.length - row.analyzedCount;

  const visibleOccurrences = entry.occurrences.slice(0, shownCount);
  const nextPageCount = Math.min(
    OCCURRENCE_PAGE_SIZE,
    entry.occurrences.length - visibleOccurrences.length,
  );

  const formTooltip = useTruncationTooltip<HTMLSpanElement>();

  return (
    <li
      className={`tw:flex tw:flex-col tw:border-b tw:border-border ${
        isSelected ? 'tw:bg-accent/50' : ''
      }`}
      data-form={entry.form}
      data-selected={String(isSelected)}
      data-testid="concordance-row"
    >
      {/*
        Carries no `aria-label`: a name on a button overrides its content, so one here would
        announce every row alike and suppress the form each lists.
      */}
      <Button
        aria-expanded={isExpanded}
        className="tw:flex tw:h-auto tw:w-full tw:items-baseline tw:justify-start tw:gap-2 tw:rounded-none tw:px-3 tw:py-2 tw:text-start tw:font-normal"
        data-testid="concordance-row-toggle"
        onClick={handleToggle}
        type="button"
        variant="ghost"
      >
        {isExpanded ? (
          <ChevronDown className="tw:size-3 tw:shrink-0" />
        ) : (
          <ChevronRight className="tw:size-3 tw:shrink-0" />
        )}
        {/*
          Native `title` rather than the platform Tooltip, since this sits inside the row's own
          button, where a tooltip trigger would nest one interactive element in another.
        */}
        <span
          className="tw:shrink-0 tw:self-center tw:text-muted-foreground"
          data-status={status}
          data-testid="concordance-row-status"
          title={statusLabel}
        >
          <StatusIcon aria-hidden className="tw:size-3" />
          <span className="tw:sr-only">{statusLabel}</span>
        </span>
        <Tooltip open={formTooltip.open}>
          <TooltipTrigger asChild>
            <span
              ref={formTooltip.ref}
              className="tw:flex-1 tw:min-w-0 tw:truncate tw:font-medium"
              data-testid="concordance-row-form"
              dir="auto"
              lang={sourceLanguageTag}
              onPointerEnter={formTooltip.onPointerEnter}
              onPointerLeave={formTooltip.onPointerLeave}
            >
              {entry.displayText}
            </span>
          </TooltipTrigger>
          <TooltipContent>{entry.displayText}</TooltipContent>
        </Tooltip>
        <span
          className="tw:text-xs tw:tabular-nums"
          data-testid="concordance-row-count"
          title={occurrenceCountLabel}
        >
          {entry.occurrences.length}
          <span className="tw:sr-only">{` ${occurrenceCountLabel}`}</span>
        </span>
        <span
          className="tw:text-xs tw:tabular-nums tw:text-muted-foreground"
          data-testid="concordance-row-count-in-book"
          title={occurrenceCountInBookLabel}
        >
          {row.occurrenceCountInBook}
          <span className="tw:sr-only">{` ${occurrenceCountInBookLabel}`}</span>
        </span>
      </Button>

      {isExpanded && (
        <div
          className="tw:flex tw:flex-col tw:gap-2 tw:px-3 tw:pb-2 tw:ps-8"
          data-testid="concordance-row-detail"
        >
          <p className="tw:flex tw:flex-wrap tw:gap-x-3 tw:text-xs">
            {tallies.map((tally) => (
              <span data-testid="concordance-tally" key={tally.analysisId}>
                {tally.gloss || noGloss}{' '}
                <span className="tw:tabular-nums tw:text-muted-foreground">{tally.count}</span>
              </span>
            ))}
            {unanalyzedCount > 0 && (
              <span className="tw:italic" data-testid="concordance-tally-unanalyzed">
                {unanalyzedLabel}{' '}
                <span className="tw:tabular-nums tw:text-muted-foreground">{unanalyzedCount}</span>
              </span>
            )}
          </p>

          <ul className="tw:flex tw:flex-col">
            {visibleOccurrences.map((occurrence) => {
              const analysisId = approvedByToken.get(occurrence.tokenRef);
              const gloss =
                analysisId === undefined ? undefined : glossByAnalysisId.get(analysisId);
              return (
                <li key={occurrence.tokenRef}>
                  <Button
                    className="tw:flex tw:h-auto tw:w-full tw:items-baseline tw:justify-start tw:gap-2 tw:px-1 tw:py-0.5 tw:text-xs tw:font-normal"
                    data-testid="concordance-occurrence"
                    data-token-ref={occurrence.tokenRef}
                    onClick={() => onOccurrenceSelect(entry.form, occurrence)}
                    variant="ghost"
                  >
                    <span className="tw:shrink-0 tw:text-muted-foreground">
                      {occurrenceLabel(occurrence)}
                    </span>
                    <ContextLineView
                      occurrence={occurrence}
                      sourceLanguageTag={sourceLanguageTag}
                    />
                    <span
                      // End padding keeps an italic label's overhanging last letter clear of the clip.
                      className={`tw:shrink-0 tw:max-w-[40%] tw:truncate tw:pe-1 ${
                        gloss === undefined ? 'tw:italic tw:text-muted-foreground' : ''
                      }`}
                      data-testid="concordance-occurrence-gloss"
                    >
                      {gloss === undefined ? unanalyzedLabel : gloss || noGloss}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
          {nextPageCount > 0 && (
            <Button
              className="tw:self-start"
              data-testid="concordance-occurrences-show-more"
              onClick={() => setShownCount((count) => count + OCCURRENCE_PAGE_SIZE)}
              size="sm"
              variant="link"
            >
              {formatReplacementString(
                localizedStrings['%interlinearizer_concordance_showMoreOccurrences%'],
                { count: nextPageCount },
              )}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Memoized version of {@link ConcordanceRowView}; use in render-stable row lists. */
const MemoizedConcordanceRowView = memo(ConcordanceRowView);
export default MemoizedConcordanceRowView;
