import { ArrowRight } from 'lucide-react';
import { Button, RadioGroup, RadioGroupItem } from 'platform-bible-react';
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
  '%interlinearizer_analysisCatalog_mergeTargetChoice%',
  '%interlinearizer_analysisCatalog_mergeUsageCount%',
  '%interlinearizer_analysisCatalog_mergeCancel%',
  '%interlinearizer_analysisCatalog_mergeConfirm%',
  '%interlinearizer_analysisCatalog_noGloss%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogMergeModal}. */
type CatalogMergeModalProps = Readonly<{
  /** The surface form both sides share, shown above them. */
  surfaceText: string;
  /** The analysis being merged away, shown on its own on the left. */
  source: CatalogRow;
  /** The analyses it may be merged into: its homographs, most-used first. */
  targets: readonly CatalogRow[];
  /** BCP 47 tag the glosses are read under. */
  analysisLanguage: string;
  /** Commits the merge, moving the source's tokens onto the chosen target. */
  onConfirm: (targetAnalysisId: string) => void;
  /** Backs out, leaving both analyses untouched. */
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
 * Picks which analysis to merge a row into, from its homographs alone — the records sharing its
 * surface form, which are the only ones a merge could sensibly reassign its tokens to.
 *
 * Read left to right across the arrow: the row the picker was opened from, then the analysis it is
 * about to become.
 *
 * Nothing is preselected: a merge moves every use of one analysis onto another and drops the
 * source, so the target is a decision to make rather than one to default into. Confirm stays
 * disabled until a choice is made.
 */
export default function CatalogMergeModal({
  surfaceText,
  source,
  targets,
  analysisLanguage,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogMergeModalProps) {
  const [targetId, setTargetId] = useState<string | undefined>(undefined);

  /**
   * The chosen target, or `undefined` once the listing stops offering it — an edit beside the panel
   * can drop the record mid-decision, and a merge into one that is gone would do nothing.
   */
  const target = targets.find((row) => row.analysisId === targetId);

  // Visible cell text, so an unresolved key would leave an analysis nameless in a list the reader
  // chooses from. The em dash reads as "no gloss" in any language, as it does in the listing.
  const noGloss =
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) || '—';

  /** Names one analysis by how many tokens carry it. */
  const usageCountLabel = (row: CatalogRow) =>
    formatReplacementString(localizedStrings['%interlinearizer_analysisCatalog_mergeUsageCount%'], {
      count: row.usageCount,
    });

  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings['%interlinearizer_analysisCatalog_mergeTitle%']}
      titleTestId="catalog-merge-title"
      width="tw:w-2xl"
    >
      <p className="tw:text-sm tw:text-muted-foreground">
        {localizedStrings['%interlinearizer_analysisCatalog_mergePrompt%']}
      </p>

      <div className="tw:mt-3 tw:flex tw:flex-col tw:gap-1">
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

      <div className="tw:mt-4 tw:flex tw:items-start tw:gap-4">
        <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-2">
          <span
            className="tw:text-xs tw:text-muted-foreground"
            data-testid="catalog-merge-source-column"
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeSourceColumn%']}
          </span>
          <div
            className="tw:flex tw:rounded tw:border tw:border-border tw:px-2 tw:py-1.5"
            data-analysis-id={source.analysisId}
            data-testid="catalog-merge-source"
          >
            <AnalysisSummary
              analysisLanguage={analysisLanguage}
              noGloss={noGloss}
              row={source}
              usageCountLabel={usageCountLabel(source)}
            />
          </div>
        </div>

        {/* Hidden from screen readers, which read the two columns' own headings and labels. */}
        <ArrowRight aria-hidden className="tw:mt-8 tw:size-4 tw:shrink-0 tw:rtl:rotate-180" />

        <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-2">
          <span
            className="tw:text-xs tw:text-muted-foreground"
            data-testid="catalog-merge-target-column"
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeTargetColumn%']}
          </span>
          <RadioGroup
            className="tw:flex tw:max-h-72 tw:flex-col tw:overflow-y-auto"
            onValueChange={setTargetId}
            value={targetId ?? ''}
          >
            <ul className="tw:flex tw:flex-col tw:gap-0.5">
              {targets.map((row) => (
                <li
                  key={row.analysisId}
                  className={`tw:flex tw:items-start tw:gap-2 tw:rounded tw:py-1.5 ${
                    row.analysisId === targetId ? 'tw:bg-accent' : ''
                  }`}
                  data-analysis-id={row.analysisId}
                  data-testid="catalog-merge-candidate"
                >
                  <RadioGroupItem
                    aria-label={formatReplacementString(
                      localizedStrings['%interlinearizer_analysisCatalog_mergeTargetChoice%'],
                      { gloss: row.gloss || noGloss },
                    )}
                    className="tw:mt-1"
                    data-testid="catalog-merge-target"
                    value={row.analysisId}
                  />
                  <AnalysisSummary
                    analysisLanguage={analysisLanguage}
                    noGloss={noGloss}
                    row={row}
                    usageCountLabel={usageCountLabel(row)}
                  />
                </li>
              ))}
            </ul>
          </RadioGroup>
        </div>
      </div>

      <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
        <Button data-testid="catalog-merge-cancel" onClick={onCancel} variant="outline">
          {localizedStrings['%interlinearizer_analysisCatalog_mergeCancel%']}
        </Button>
        <Button
          data-testid="catalog-merge-confirm"
          disabled={!target}
          /* v8 ignore next -- the button is disabled without a target, so the guard cannot fail */
          onClick={() => target && onConfirm(target.analysisId)}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
