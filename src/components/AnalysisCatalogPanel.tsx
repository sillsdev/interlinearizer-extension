import { useLocalizedStrings } from '@papi/frontend/react';
import { X } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { useCallback, useMemo, useState } from 'react';
import { useAnalysisLanguage, useCatalogRows } from './AnalysisStore';
import CatalogRowView from './CatalogRowView';
import { useInterlinearNav } from './InterlinearNavContext';
import usePanelResize, { type PanelWidthBounds } from '../hooks/usePanelResize';
import { applyCatalogQuery, type CatalogQuery, type CatalogUsage } from '../utils/analysis-query';

/**
 * Localized string keys the panel needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders; a fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_analysisCatalog_title%',
  '%interlinearizer_analysisCatalog_close%',
  '%interlinearizer_analysisCatalog_resize%',
  '%interlinearizer_analysisCatalog_empty%',
] as const satisfies `%${string}%`[];

/**
 * How far the panel may be resized: narrow enough that the usage counts still fit, wide enough that
 * a drag can never squeeze the interlinear view out entirely.
 */
const WIDTH_BOUNDS: PanelWidthBounds = { min: 220, max: 800 };

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
   * How the listing is narrowed and ordered: unnarrowed, most-used first. The panel offers no
   * control over any of it, so the values here are the whole of what the reader gets.
   */
  const query = useMemo<CatalogQuery>(
    () => ({
      search: '',
      sort: 'usageCount',
      filters: {},
      surfaceCollator: new Intl.Collator(sourceLanguageTag),
      glossCollator: new Intl.Collator(analysisLanguage),
    }),
    [sourceLanguageTag, analysisLanguage],
  );

  const rows = useMemo(() => applyCatalogQuery(catalogRows, query), [catalogRows, query]);

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
   * The focus request is raised before the navigation, not after: a pending request is abandoned
   * once navigation lands on a book other than the one it names, so one raised afterward would be
   * discarded by its own navigation. A cross-book jump therefore leaves the request outstanding
   * until that book's view mounts and claims it.
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

  const {
    displayWidth,
    onMouseDown: handleResizeMouseDown,
    onKeyDown: handleResizeKeyDown,
  } = usePanelResize(width, onWidthChange, WIDTH_BOUNDS);

  return (
    <div
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
        aria-valuemax={WIDTH_BOUNDS.max}
        aria-valuemin={WIDTH_BOUNDS.min}
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

        {rows.length === 0 ? (
          <p className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_empty%']}
          </p>
        ) : (
          <ul className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-y-auto">
            {rows.map((row) => (
              <CatalogRowView
                key={row.analysisId}
                currentBook={currentBook}
                isSelected={row.analysisId === selectedAnalysisId}
                onUsageSelect={handleUsageSelect}
                row={row}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
