import { Info } from 'lucide-react';
import {
  Button,
  RadioGroup,
  RadioGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useState } from 'react';
import { ModalShell } from './modals/ModalShell';
import type { CatalogRow } from '../utils/analysis-query';
import { resolvedOrEmpty } from '../utils/localized-strings';

/** Localized string keys the merge picker renders. */
export const MERGE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_mergeTitle%',
  '%interlinearizer_analysisCatalog_mergePrompt%',
  '%interlinearizer_analysisCatalog_mergeForm%',
  '%interlinearizer_analysisCatalog_mergeSourceColumn%',
  '%interlinearizer_analysisCatalog_mergeTargetColumn%',
  '%interlinearizer_analysisCatalog_mergeSourceChoice%',
  '%interlinearizer_analysisCatalog_mergeTargetChoice%',
  '%interlinearizer_analysisCatalog_mergeUsageCount%',
  '%interlinearizer_analysisCatalog_mergeCancel%',
  '%interlinearizer_analysisCatalog_mergeConfirm%',
  '%interlinearizer_analysisCatalog_noGloss%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogMergeModal}. */
type CatalogMergeModalProps = Readonly<{
  /** The surface form every listed analysis shares, shown above them. */
  surfaceText: string;
  /** Every analysis of the form, most-used first — each one a candidate for either end. */
  candidates: readonly CatalogRow[];
  /** The analysis the picker was opened from, which starts as the source. */
  initialSourceId: string;
  /** BCP 47 tag the glosses are read under. */
  analysisLanguage: string;
  /** Commits the merge, moving the source's tokens onto the target. */
  onConfirm: (sourceAnalysisId: string, targetAnalysisId: string) => void;
  /** Backs out, leaving every analysis untouched. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link MERGE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** Props for {@link AnalysisSummary}. */
type AnalysisSummaryProps = Readonly<{
  row: CatalogRow;
  analysisLanguage: string;
  /** Text shown where the analysis has no gloss in the analysis language. */
  noGloss: string;
  usageCountLabel: string;
}>;

/**
 * What one analysis says: its gloss and usage count, over its morpheme breakdown — the breakdown
 * being what tells apart two analyses their glosses cannot.
 */
function AnalysisSummary({
  row,
  analysisLanguage,
  noGloss,
  usageCountLabel,
}: AnalysisSummaryProps) {
  return (
    <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-1">
      <div className="tw:flex tw:items-baseline tw:gap-2">
        <span className="tw:min-w-0 tw:flex-1 tw:truncate" data-testid="catalog-merge-gloss">
          {row.gloss || noGloss}
        </span>
        <span className="tw:text-xs tw:tabular-nums tw:text-muted-foreground">
          {usageCountLabel}
        </span>
      </div>

      {row.morphemes.length > 0 && (
        <div
          className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5"
          data-testid="catalog-merge-breakdown"
        >
          {row.morphemes.map((morpheme) => (
            <div className="tw:flex tw:min-w-0 tw:flex-col" key={morpheme.id}>
              <span className="tw:truncate tw:font-mono tw:text-xs">{morpheme.form}</span>
              <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                {morpheme.gloss?.[analysisLanguage] ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Picks both ends of a merge from one listing of an analysis's homographs — the records sharing its
 * surface form, which are the only ones a merge could sensibly reassign its tokens between.
 *
 * Every analysis of the form is offered on both sides, so a merge can be reversed here rather than
 * from the other row. The one the picker was opened from starts as the source, that click having
 * said which analysis the reader means to spend.
 *
 * No target is preselected: a merge moves every use of one analysis onto another and drops the
 * source, so the destination is a decision to make rather than one to default into, and Confirm
 * stays disabled until it is made.
 */
export default function CatalogMergeModal({
  surfaceText,
  candidates,
  initialSourceId,
  analysisLanguage,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogMergeModalProps) {
  const [sourceId, setSourceId] = useState<string | undefined>(initialSourceId);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);

  /**
   * Claims one end of the merge for an analysis, releasing the other end where that same analysis
   * held it: nothing merges into itself, and a radio cannot be unchecked by clicking.
   */
  const chooseSource = (analysisId: string) => {
    setSourceId(analysisId);
    if (analysisId === targetId) setTargetId(undefined);
  };

  const chooseTarget = (analysisId: string) => {
    setTargetId(analysisId);
    if (analysisId === sourceId) setSourceId(undefined);
  };

  /**
   * Each end, or `undefined` once the listing stops offering it — an edit beside the panel can drop
   * either record mid-decision, and a merge involving one that is gone would do nothing.
   */
  const source = candidates.find((row) => row.analysisId === sourceId);
  const target = candidates.find((row) => row.analysisId === targetId);

  // Visible cell text, so an unresolved key would leave an analysis nameless in a list the reader
  // chooses from. The em dash reads as "no gloss" in any language, as it does in the listing.
  const noGloss =
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) || '—';

  /** Names one analysis by how many tokens carry it. */
  const usageCountLabel = (row: CatalogRow) =>
    formatReplacementString(localizedStrings['%interlinearizer_analysisCatalog_mergeUsageCount%'], {
      count: row.usageCount,
    });

  /** Names one side's radio by the analysis it would put there. */
  const choiceLabel = (key: `%${string}%`, row: CatalogRow) =>
    formatReplacementString(localizedStrings[key], { gloss: row.gloss || noGloss });

  return (
    // The dialog portals to the document body, outside the panel's provider, and a Tooltip without
    // one throws.
    <TooltipProvider delayDuration={0}>
      <ModalShell
        onClose={onCancel}
        title={localizedStrings['%interlinearizer_analysisCatalog_mergeTitle%']}
        // A button so the explanation is reachable by keyboard; it opens nothing, the tooltip being
        // the whole of its behavior.
        titleAdornment={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergePrompt%']}
                className="tw:size-auto tw:p-0 tw:text-muted-foreground"
                data-testid="catalog-merge-prompt"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Info aria-hidden className="tw:size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {localizedStrings['%interlinearizer_analysisCatalog_mergePrompt%']}
            </TooltipContent>
          </Tooltip>
        }
        titleTestId="catalog-merge-title"
        // Sized to its rows, up to a cap the summary column truncates against.
        width="tw:w-fit tw:max-w-2xl"
      >
        {/* The form is what the whole choice is about, so it is centered over the listing. */}
        <div className="tw:flex tw:flex-col tw:items-center tw:gap-1">
          <span
            className="tw:text-xs tw:text-muted-foreground"
            data-testid="catalog-merge-form-label"
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeForm%']}
          </span>
          <p className="tw:text-lg tw:font-semibold" data-testid="catalog-merge-form">
            {surfaceText}
          </p>
        </div>

        {/*
          A column per side rather than a radio pair per row, because radio groups cannot nest: an
          inner group's context shadows the outer one, leaving every radio answering to one column.
          The groups drop out of the layout so their cells place into this grid, which each cell
          addresses by explicit row and column — emitted a column at a time, they would otherwise
          auto-place down the grid rather than across. Row 1 holds the headings.

          The summary column's floor keeps a one-word gloss from collapsing the rows, and its
          ceiling makes a long one truncate rather than widen them.

          The height is capped against the viewport rather than a row count, the dialog setting no
          height of its own, so the list scrolls only where the rows do not fit.
        */}
        <div
          className="tw:mt-4 tw:grid tw:max-h-[60vh] tw:min-w-0 tw:grid-cols-[auto_minmax(16rem,1fr)_auto] tw:items-start tw:gap-x-4 tw:overflow-x-hidden tw:overflow-y-auto"
          data-testid="catalog-merge-candidates"
        >
          <span
            className="tw:px-2 tw:pb-1 tw:text-center tw:text-xs tw:font-medium tw:text-muted-foreground"
            data-testid="catalog-merge-source-column"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeSourceColumn%']}
          </span>
          <span
            className="tw:px-2 tw:pb-1 tw:text-center tw:text-xs tw:font-medium tw:text-muted-foreground"
            data-testid="catalog-merge-target-column"
            style={{ gridColumn: 3, gridRow: 1 }}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeTargetColumn%']}
          </span>

          <RadioGroup className="tw:contents" onValueChange={chooseSource} value={sourceId ?? ''}>
            {candidates.map((row, index) => (
              <RadioGroupItem
                key={row.analysisId}
                aria-label={choiceLabel('%interlinearizer_analysisCatalog_mergeSourceChoice%', row)}
                className="tw:my-2 tw:justify-self-center"
                data-testid="catalog-merge-source"
                style={{ gridColumn: 1, gridRow: index + 2 }}
                value={row.analysisId}
              />
            ))}
          </RadioGroup>

          {candidates.map((row, index) => (
            <div
              key={row.analysisId}
              className={`tw:flex tw:min-w-0 tw:rounded tw:px-2 tw:py-1.5 ${
                row.analysisId === sourceId || row.analysisId === targetId ? 'tw:bg-accent' : ''
              }`}
              data-analysis-id={row.analysisId}
              data-testid="catalog-merge-candidate"
              style={{ gridColumn: 2, gridRow: index + 2 }}
            >
              <AnalysisSummary
                analysisLanguage={analysisLanguage}
                noGloss={noGloss}
                row={row}
                usageCountLabel={usageCountLabel(row)}
              />
            </div>
          ))}

          <RadioGroup className="tw:contents" onValueChange={chooseTarget} value={targetId ?? ''}>
            {candidates.map((row, index) => (
              <RadioGroupItem
                key={row.analysisId}
                aria-label={choiceLabel('%interlinearizer_analysisCatalog_mergeTargetChoice%', row)}
                className="tw:my-2 tw:justify-self-center"
                data-testid="catalog-merge-target"
                style={{ gridColumn: 3, gridRow: index + 2 }}
                value={row.analysisId}
              />
            ))}
          </RadioGroup>
        </div>

        <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
          <Button data-testid="catalog-merge-cancel" onClick={onCancel} variant="outline">
            {localizedStrings['%interlinearizer_analysisCatalog_mergeCancel%']}
          </Button>
          <Button
            data-testid="catalog-merge-confirm"
            disabled={!source || !target}
            /* v8 ignore next -- the button is disabled without both ends, so the guard cannot fail */
            onClick={() => source && target && onConfirm(source.analysisId, target.analysisId)}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
          </Button>
        </div>
      </ModalShell>
    </TooltipProvider>
  );
}
