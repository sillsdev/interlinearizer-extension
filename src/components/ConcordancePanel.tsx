import { X } from 'lucide-react';
import { Button, EmptyState, TooltipProvider } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAnalysisLanguage } from './AnalysisStore';
import ConcordanceRowView, { CONCORDANCE_ROW_STRING_KEYS } from './ConcordanceRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import SidePanelTabs, { SIDE_PANEL_TAB_STRING_KEYS } from './SidePanelTabs';
import TextReadingStatus, { TEXT_READING_STRING_KEYS } from './TextReadingStatus';
import { useTextReadStatus } from '../cache/catalogHooks';
import { useConcordanceView, useRetryTextRead } from '../cache/concordanceHooks';
import useRowWindow from '../hooks/useRowWindow';
import type { ConcordanceOccurrence } from '../utils/concordance';

/**
 * Localized string keys the panel needs, the rows' among them so the list resolves once rather than
 * once per form.
 */
export const CONCORDANCE_PANEL_STRING_KEYS = [
  '%interlinearizer_concordance_close%',
  '%interlinearizer_concordance_empty%',
  '%interlinearizer_concordance_booksRead%',
  '%interlinearizer_concordance_unreadBooks%',
  '%interlinearizer_concordance_retry%',
  '%interlinearizer_concordance_occurrenceCountInBook%',
  ...SIDE_PANEL_TAB_STRING_KEYS,
  ...CONCORDANCE_ROW_STRING_KEYS,
  ...TEXT_READING_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** How many rows are asked of the host before the list has been scrolled. */
const INITIAL_FETCH_COUNT = 40;

/** How far past the rows that have arrived the window may grow while it waits for more. */
const FETCH_AHEAD_COUNT = 40;

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
  const readStatus = useTextReadStatus(true);
  const analysisLanguage = useAnalysisLanguage();

  // Asked for as many rows as the window mounts, so the window can grow past what has arrived.
  const [fetchCount, setFetchCount] = useState(INITIAL_FETCH_COUNT);
  const view = useConcordanceView(currentBook, fetchCount);
  const total = view?.total ?? 0;
  // Capped past the rows that have arrived. Otherwise a sentinel left in reach while they are
  // asked for would grow the window, and the count asked for, to the whole concordance.
  const slotCount = Math.min(total, (view?.rows.length ?? 0) + FETCH_AHEAD_COUNT);
  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_unused, index) => index),
    [slotCount],
  );
  // A failed fetch leaves the window at its cap, so reaching the end there fetches the page again.
  const {
    windowRows: windowSlots,
    scrollRef,
    sentinelRef,
  } = useRowWindow(slots, undefined, undefined, view?.retry);
  if (windowSlots.length > fetchCount) setFetchCount(windowSlots.length);
  const windowRows = useMemo(
    () => view?.rows.slice(0, windowSlots.length) ?? [],
    [view, windowSlots.length],
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

  const retryTextRead = useRetryTextRead();

  const failedBookIds =
    readStatus === undefined || readStatus === 'error' ? [] : readStatus.failedBookIds;

  let body: ReactNode;
  // The failed books may hold words, so an empty list then means the read failed.
  if (!view || (total === 0 && failedBookIds.length > 0)) {
    body = (
      <TextReadingStatus
        idPrefix="concordance"
        localizedStrings={localizedStrings}
        status={readStatus}
      />
    );
  } else if (total === 0) {
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
            key={row.form}
            analysisLanguage={analysisLanguage}
            isSelected={row.form === selectedForm}
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
        {view && (
          <div
            className={`tw:border-b tw:border-border tw:px-3 tw:py-2 tw:text-xs ${failedBookIds.length > 0 ? 'tw:bg-accent/50' : 'tw:text-muted-foreground'}`}
            data-testid="concordance-read-summary"
            role="status"
          >
            <p data-testid="concordance-books-read">
              {formatReplacementString(
                localizedStrings['%interlinearizer_concordance_booksRead%'],
                { count: view.bookCount },
              )}
            </p>
            {failedBookIds.length > 0 && (
              <p className="tw:flex tw:items-center tw:gap-2">
                <span data-testid="concordance-unread-books">
                  {formatReplacementString(
                    localizedStrings['%interlinearizer_concordance_unreadBooks%'],
                    { books: failedBookIds.join(', ') },
                  )}
                </span>
                <Button
                  className="tw:h-auto tw:p-0 tw:text-xs"
                  data-testid="concordance-retry"
                  onClick={retryTextRead}
                  size="sm"
                  variant="link"
                >
                  {localizedStrings['%interlinearizer_concordance_retry%']}
                </Button>
              </p>
            )}
          </div>
        )}
        {body}
      </div>
    </TooltipProvider>
  );
}
