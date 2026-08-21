import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { X } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback, useMemo, useState } from 'react';
import { useAnalysisLanguage, useCatalogRows } from './AnalysisStore';
import CatalogRowView, { ROW_STRING_KEYS } from './CatalogRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import { applyCatalogQuery, type CatalogQuery, type CatalogUsage } from '../utils/analysis-query';
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
  ...ROW_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link AnalysisCatalogPanel}. */
type AnalysisCatalogPanelProps = Readonly<{
  /** Dismisses the panel. */
  onClose: () => void;
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
  currentBook,
  sourceLanguageTag,
}: AnalysisCatalogPanelProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const analysisLanguage = useAnalysisLanguage();
  const catalogRows = useCatalogRows(currentBook);

  /**
   * How the listing is narrowed and ordered: unnarrowed, most-used first. The panel offers no
   * control over any of it, so the values here are the whole of what the reader gets.
   */
  const query = useMemo<CatalogQuery>(
    () => ({
      search: '',
      sort: 'usageCount',
      filters: {},
      surfaceCollator: collatorForTag(sourceLanguageTag),
      glossCollator: collatorForTag(analysisLanguage),
    }),
    [sourceLanguageTag, analysisLanguage],
  );

  const rows = useMemo(() => applyCatalogQuery(catalogRows, query), [catalogRows, query]);

  /**
   * Label every row carries for its per-book usage count, resolved once for the whole list. The
   * book's English name rather than its code, because this label reads as prose where the usage
   * links below it read as references. A platform-localized name would need PAPI wiring this view
   * does not yet have.
   */
  const usageCountInBookLabel = useMemo(
    () =>
      formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_usageCountInBook%'],
        { book: Canon.bookIdToEnglishName(currentBook) },
      ),
    [localizedStrings, currentBook],
  );

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

      {rows.length === 0 ? (
        <p className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
          {localizedStrings['%interlinearizer_analysisCatalog_empty%']}
        </p>
      ) : (
        <ul className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto">
          {rows.map((row) => (
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
        </ul>
      )}
    </div>
  );
}
