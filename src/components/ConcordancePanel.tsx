import { RefreshCw, X } from 'lucide-react';
import {
  Button,
  EmptyState,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAnalysis, useAnalysisLanguage } from './AnalysisStore';
import { useConcordanceEntriesContext, useSourceTextContext } from './SourceTextContext';
import ConcordanceRowView, { CONCORDANCE_ROW_STRING_KEYS } from './ConcordanceRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import SidePanelTabs, { SIDE_PANEL_TAB_STRING_KEYS } from './SidePanelTabs';
import TextReadingStatus, { TEXT_READING_STRING_KEYS } from './TextReadingStatus';
import useRowWindow from '../hooks/useRowWindow';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../utils/localized-strings';
import {
  approvedAnalysisByToken,
  deriveConcordanceRows,
  type ConcordanceOccurrence,
} from '../utils/concordance';

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per form.
 */
export const CONCORDANCE_PANEL_STRING_KEYS = [
  '%interlinearizer_concordance_close%',
  '%interlinearizer_concordance_refresh%',
  '%interlinearizer_concordance_empty%',
  '%interlinearizer_concordance_partial%',
  '%interlinearizer_concordance_occurrenceCountInBook%',
  ...SIDE_PANEL_TAB_STRING_KEYS,
  ...CONCORDANCE_ROW_STRING_KEYS,
  ...TEXT_READING_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link ConcordancePanel}. */
type ConcordancePanelProps = Readonly<{
  /** Book code each row's per-book occurrence count is taken in. */
  currentBook: string;
  /** BCP 47 tag of the source text, so forms render as their own language. */
  sourceLanguageTag: string;
  /** Dismisses the side panel. */
  onClose: () => void;
  /** Switches the side panel to the analysis catalog. */
  onShowCatalog: () => void;
  /** Resolved localizations covering at least {@link CONCORDANCE_PANEL_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** What the current book is called where the rows name it in prose. */
  currentBookName: string;
}>;

/**
 * The concordance: every word form of the source text, with how often it occurs and how much of it
 * is analyzed, each form's occurrences listed in their verses.
 *
 * Sits beside the interlinear view rather than over it, so a jump to an occurrence can move the
 * view while the list the jump came from stays on screen.
 */
export default function ConcordancePanel({
  currentBook,
  sourceLanguageTag,
  onClose,
  onShowCatalog,
  localizedStrings,
  currentBookName,
}: ConcordancePanelProps) {
  const refreshTooltip = tooltipContentOrUndefined(
    resolvedOrEmpty(localizedStrings['%interlinearizer_concordance_refresh%']),
  );
  const text = useSourceTextContext();
  const entries = useConcordanceEntriesContext();
  const analysis = useAnalysis();
  const analysisLanguage = useAnalysisLanguage();

  const analysesById = useMemo(
    () => new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta])),
    [analysis.tokenAnalyses],
  );
  const approvedByToken = useMemo(
    () => approvedAnalysisByToken(analysis.tokenAnalysisLinks, analysesById),
    [analysis.tokenAnalysisLinks, analysesById],
  );

  // Keyed on the status so a refresh, which passes through loading, starts the window over.
  const { windowRows: windowEntries, scrollRef, sentinelRef } = useRowWindow(entries, text.status);

  // Joined only for the mounted rows: a join over every form walks every occurrence in the text,
  // too much to repeat on each gloss written beside the panel.
  const windowRows = useMemo(
    () => deriveConcordanceRows(windowEntries, approvedByToken, currentBook),
    [windowEntries, approvedByToken, currentBook],
  );

  /** Label every row carries for its per-book occurrence count. */
  const occurrenceCountInBookLabel = useMemo(
    () =>
      formatReplacementString(
        localizedStrings['%interlinearizer_concordance_occurrenceCountInBook%'],
        { book: currentBookName },
      ),
    [currentBookName, localizedStrings],
  );

  const { navigate, requestFocusToken } = useInterlinearNav();

  /**
   * The form whose occurrence was last jumped to. Marks where in the list the view came from, so a
   * jump that scrolls the text away does not also lose the reader's place in the concordance.
   */
  const [selectedForm, setSelectedForm] = useState<string | undefined>(undefined);

  /**
   * Moves the interlinear view to an occurrence: the verse it sits in, then the token itself. The
   * focus request goes first, so it is already waiting when a jump into another book lands there.
   */
  const handleOccurrenceSelect = useCallback(
    (form: string, occurrence: ConcordanceOccurrence) => {
      setSelectedForm(form);
      requestFocusToken(occurrence.tokenRef);
      navigate({
        book: occurrence.book,
        chapterNum: occurrence.chapter,
        verseNum: occurrence.verse,
      });
    },
    [navigate, requestFocusToken],
  );

  let body: ReactNode;
  if (text.status !== 'ready') {
    body = (
      <TextReadingStatus idPrefix="concordance" localizedStrings={localizedStrings} text={text} />
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        className="tw:px-3 tw:py-2"
        id="concordance-empty"
        message={localizedStrings['%interlinearizer_concordance_empty%']}
      />
    );
  } else {
    body = (
      <ul className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto" ref={scrollRef}>
        {windowRows.map((row) => (
          <ConcordanceRowView
            key={row.entry.form}
            analysesById={analysesById}
            analysisLanguage={analysisLanguage}
            approvedByToken={approvedByToken}
            isSelected={row.entry.form === selectedForm}
            localizedStrings={localizedStrings}
            occurrenceCountInBookLabel={occurrenceCountInBookLabel}
            onOccurrenceSelect={handleOccurrenceSelect}
            row={row}
            sourceLanguageTag={sourceLanguageTag}
          />
        ))}
        {/* A list item rather than a bare div, since a `ul` may hold nothing else. */}
        <li aria-hidden data-testid="concordance-rows-sentinel" ref={sentinelRef} />
      </ul>
    );
  }

  return (
    // The panel sits beside the interlinear view rather than within it, so its tooltips have no
    // enclosing provider to inherit, and a Tooltip without one throws.
    <TooltipProvider delayDuration={0}>
      <div
        className="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:border-s tw:border-border tw:bg-background"
        data-testid="concordance-panel"
      >
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-border">
          <SidePanelTabs
            active="concordance"
            localizedStrings={localizedStrings}
            onSelect={onShowCatalog}
          />
          <div className="tw:flex tw:items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={localizedStrings['%interlinearizer_concordance_refresh%']}
                  data-testid="concordance-refresh"
                  disabled={text.status === 'loading'}
                  onClick={text.refresh}
                  size="icon"
                  variant="ghost"
                >
                  <RefreshCw className="tw:size-4" />
                </Button>
              </TooltipTrigger>
              {refreshTooltip !== undefined && <TooltipContent>{refreshTooltip}</TooltipContent>}
            </Tooltip>
            <Button
              aria-label={localizedStrings['%interlinearizer_concordance_close%']}
              data-testid="concordance-close"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X className="tw:size-4" />
            </Button>
          </div>
        </div>
        {text.isPartial && (
          <p
            className="tw:border-b tw:border-border tw:bg-accent/50 tw:px-3 tw:py-2 tw:text-xs"
            data-testid="concordance-partial"
            role="status"
          >
            {localizedStrings['%interlinearizer_concordance_partial%']}
          </p>
        )}
        {body}
      </div>
    </TooltipProvider>
  );
}
