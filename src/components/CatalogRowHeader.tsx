import { ChevronDown, ChevronRight, SearchX, TriangleAlert } from 'lucide-react';
import {
  Button,
  Checkbox,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTruncationTooltip,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { CatalogRow } from '../utils/analysis-query';
import { resolvedOrEmpty } from '../utils/localized-strings';
import { SENSE_LINK_MARK_STRING_KEYS, SenseLinkMark } from './CatalogSenseLinks';
import { useLinkedGloss } from './LexiconSenses';
import LocalizedTooltip from './LocalizedTooltip';

/** Localized string keys a row header renders. */
export const ROW_HEADER_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_check%',
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_usageCount%',
  '%interlinearizer_analysisCatalog_staleCount%',
  '%interlinearizer_analysisCatalog_notInText%',
  ...SENSE_LINK_MARK_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogRowHeader}. */
type CatalogRowHeaderProps = Readonly<{
  /** The analysis the row lists. */
  row: CatalogRow;
  /** BCP 47 tag of `row.gloss`, which the gloss of a linked lexicon sense is read in too. */
  analysisLanguage: string;
  /** Finished label for `row.usageCountInBook`, naming the book that count was taken against. */
  usageCountInBookLabel: string;
  /** Whether the row's detail is showing. */
  isExpanded: boolean;
  /** Shows the row's detail, or hides it. */
  onToggle: () => void;
  /** Whether the source text, as last read, holds this analysis's form nowhere. */
  isNotInText: boolean;
  /** Whether the row is among those a bulk action applies to. */
  isChecked: boolean;
  /**
   * Adds the row to, or takes it out of, the rows a bulk action applies to. Absent for a read-only
   * analysis, which no bulk action applies to.
   */
  onCheckedChange?: (analysisId: string, checked: boolean) => void;
  /** Resolved localizations covering at least {@link ROW_HEADER_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * The line a catalog row always shows: its check box, and the toggle naming the analysis by its
 * surface form, gloss, and usage counts. A gloss whose analysis links to a lexicon sense is marked.
 * Where the analysis stores no gloss, the sense's gloss is shown in its place.
 */
export default function CatalogRowHeader({
  row,
  analysisLanguage,
  usageCountInBookLabel,
  isExpanded,
  onToggle,
  isNotInText,
  isChecked,
  onCheckedChange,
  localizedStrings,
}: CatalogRowHeaderProps) {
  const usageCountLabel = localizedStrings['%interlinearizer_analysisCatalog_usageCount%'];
  const staleCountLabel = localizedStrings['%interlinearizer_analysisCatalog_staleCount%'];
  const notInTextLabel = localizedStrings['%interlinearizer_analysisCatalog_notInText%'];

  const link = useLinkedGloss(row.gloss, row.glossSenseRef, analysisLanguage);
  // This is visible cell text, so blanking an unresolved key would empty the gloss column. The em
  // dash reads as "no gloss" in any language and stands in until the lookup lands.
  const glossLabel =
    link.text ||
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) ||
    '—';

  // One tooltip each rather than one for the row: either column may be the clipped one, and a
  // tooltip is worth opening only over the text that is actually cut off.
  const surfaceTooltip = useTruncationTooltip<HTMLSpanElement>();
  const glossTooltip = useTruncationTooltip<HTMLSpanElement>();

  return (
    // Highlighted here rather than on the button, so the highlight takes in the checkbox too.
    <div
      className={`tw:col-span-full tw:grid tw:grid-cols-subgrid tw:items-center tw:ps-3 tw:pe-3 tw:hover:bg-muted tw:dark:hover:bg-muted/50 ${
        isExpanded ? 'tw:bg-muted' : ''
      }`}
    >
      {onCheckedChange && (
        <Checkbox
          aria-label={formatReplacementString(
            localizedStrings['%interlinearizer_analysisCatalog_check%'],
            { form: row.surfaceText, gloss: glossLabel },
          )}
          checked={isChecked}
          className="tw:col-start-1 tw:me-2"
          data-testid="catalog-row-check"
          onCheckedChange={(checked: boolean) => onCheckedChange(row.analysisId, checked)}
        />
      )}
      {/*
        Carries no `aria-label`: a name on a button overrides its content, so one here would
        announce every row alike and suppress the analysis each lists.
      */}
      <Button
        aria-expanded={isExpanded}
        // Overrides the platform button's own box: this is a row of the list, not a control
        // sitting in one.
        className="tw:col-[2/-1] tw:grid tw:grid-cols-subgrid tw:h-auto tw:items-baseline tw:gap-0 tw:rounded-none tw:px-0 tw:py-2 tw:text-start tw:font-normal tw:hover:bg-transparent tw:dark:hover:bg-transparent tw:aria-expanded:bg-transparent"
        data-testid="catalog-row-toggle"
        onClick={onToggle}
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
              className="tw:ms-2 tw:min-w-0 tw:truncate tw:font-medium"
              data-testid="catalog-row-surface"
              onPointerEnter={surfaceTooltip.onPointerEnter}
              onPointerLeave={surfaceTooltip.onPointerLeave}
            >
              {row.surfaceText}
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.surfaceText}</TooltipContent>
        </Tooltip>
        <span className="tw:ms-2 tw:flex tw:min-w-0 tw:items-baseline tw:gap-1">
          <Tooltip open={glossTooltip.open}>
            <TooltipTrigger asChild>
              <span
                ref={glossTooltip.ref}
                className="tw:min-w-0 tw:truncate tw:text-sm tw:text-muted-foreground"
                data-testid="catalog-row-gloss"
                onPointerEnter={glossTooltip.onPointerEnter}
                onPointerLeave={glossTooltip.onPointerLeave}
              >
                {glossLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent>{glossLabel}</TooltipContent>
          </Tooltip>
          {row.glossSenseRef && <SenseLinkMark link={link} localizedStrings={localizedStrings} />}
        </span>
        <LocalizedTooltip label={usageCountLabel}>
          <span
            className="tw:ms-2 tw:text-end tw:text-xs tw:tabular-nums"
            data-testid="catalog-row-usage-count"
          >
            {row.usageCount}
            <span className="tw:sr-only">{` ${usageCountLabel}`}</span>
          </span>
        </LocalizedTooltip>
        <LocalizedTooltip label={usageCountInBookLabel}>
          <span
            className="tw:ms-2 tw:text-end tw:text-xs tw:tabular-nums tw:text-muted-foreground"
            data-testid="catalog-row-usage-count-in-book"
          >
            {row.usageCountInBook}
            <span className="tw:sr-only">{` ${usageCountInBookLabel}`}</span>
          </span>
        </LocalizedTooltip>
        {row.staleLocations.length > 0 && (
          <LocalizedTooltip label={staleCountLabel}>
            <span
              className="tw:ms-2 tw:flex tw:items-center tw:justify-end tw:gap-0.5 tw:text-xs tw:tabular-nums tw:gloss-stale"
              data-testid="catalog-row-stale-count"
            >
              <TriangleAlert className="tw:size-3" />
              {row.staleLocations.length}
              <span className="tw:sr-only">{` ${staleCountLabel}`}</span>
            </span>
          </LocalizedTooltip>
        )}
        {isNotInText && (
          <LocalizedTooltip label={notInTextLabel}>
            {/* Placed in the last column, since the stale count before it may be absent. */}
            <span
              className="tw:col-[-2/-1] tw:ms-2 tw:flex tw:items-center tw:text-xs tw:gloss-stale"
              data-testid="catalog-row-not-in-text"
            >
              <SearchX className="tw:size-3" />
              <span className="tw:sr-only">{` ${notInTextLabel}`}</span>
            </span>
          </LocalizedTooltip>
        )}
      </Button>
    </div>
  );
}
