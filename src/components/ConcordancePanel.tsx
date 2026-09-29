import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { RefreshCw, X } from 'lucide-react';
import { Button, EmptyState, Spinner, TooltipProvider } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAnalysis, useAnalysisLanguage } from './AnalysisStore';
import { useConcordanceIndexContext } from './ConcordanceIndexContext';
import ConcordanceRowView, { CONCORDANCE_ROW_STRING_KEYS } from './ConcordanceRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import SidePanelTabs, { SIDE_PANEL_TAB_STRING_KEYS } from './SidePanelTabs';
import useRowWindow from '../hooks/useRowWindow';
import {
  approvedAnalysisByToken,
  deriveConcordanceRows,
  type ConcordanceOccurrence,
} from '../utils/concordance';

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per form.
 */
const STRING_KEYS = [
  '%interlinearizer_concordance_close%',
  '%interlinearizer_concordance_refresh%',
  '%interlinearizer_concordance_loading%',
  '%interlinearizer_concordance_error%',
  '%interlinearizer_concordance_empty%',
  '%interlinearizer_concordance_occurrenceCountInBook%',
  ...SIDE_PANEL_TAB_STRING_KEYS,
  ...CONCORDANCE_ROW_STRING_KEYS,
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
}: ConcordancePanelProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const index = useConcordanceIndexContext();
  const analysis = useAnalysis();
  const analysisLanguage = useAnalysisLanguage();

  const approvedByToken = useMemo(
    () => approvedAnalysisByToken(analysis.tokenAnalysisLinks),
    [analysis.tokenAnalysisLinks],
  );
  const analysesById = useMemo(
    () => new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta])),
    [analysis.tokenAnalyses],
  );

  // Keyed on the status so a refresh, which passes through loading, starts the window over.
  const {
    windowRows: windowEntries,
    scrollRef,
    sentinelRef,
  } = useRowWindow(index.entries, index.status);

  // Joined only for the mounted rows: a join over every form walks every occurrence in the text,
  // too much to repeat on each gloss written beside the panel.
  const windowRows = useMemo(
    () => deriveConcordanceRows(windowEntries, approvedByToken, currentBook),
    [windowEntries, approvedByToken, currentBook],
  );

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
   * Label every row carries for its per-book occurrence count, naming the book in the interface
   * language where the platform has a name for it and in English otherwise.
   */
  const occurrenceCountInBookLabel = useMemo(() => {
    const [bookKey] = bookNameKeys;
    const resolved = localizedBookName?.[bookKey];
    const bookName =
      resolved && resolved !== bookKey ? resolved : Canon.bookIdToEnglishName(currentBook);
    return formatReplacementString(
      localizedStrings['%interlinearizer_concordance_occurrenceCountInBook%'],
      { book: bookName },
    );
  }, [bookNameKeys, localizedBookName, currentBook, localizedStrings]);

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
  if (index.status === 'error') {
    body = (
      <EmptyState
        className="tw:px-3 tw:py-2"
        id="concordance-error"
        message={localizedStrings['%interlinearizer_concordance_error%']}
      />
    );
  } else if (index.status !== 'ready') {
    body = (
      <p
        className="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground"
        data-testid="concordance-loading"
        role="status"
      >
        <Spinner className="tw:size-4" />
        {formatReplacementString(localizedStrings['%interlinearizer_concordance_loading%'], {
          read: index.booksRead,
          total: index.bookCount,
        })}
      </p>
    );
  } else if (index.entries.length === 0) {
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
    // The panel sits beside the interlinear view rather than within it, so the row tooltips have no
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
            <Button
              aria-label={localizedStrings['%interlinearizer_concordance_refresh%']}
              data-testid="concordance-refresh"
              disabled={index.status === 'loading'}
              onClick={index.refresh}
              size="icon"
              title={localizedStrings['%interlinearizer_concordance_refresh%']}
              variant="ghost"
            >
              <RefreshCw className="tw:size-4" />
            </Button>
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
        {body}
      </div>
    </TooltipProvider>
  );
}
