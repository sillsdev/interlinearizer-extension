import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { ModalShell } from './modals/ModalShell';
import type { AnalysisDeletionOutcome } from '../store/analysisSlice';

/** Localized string keys the delete confirmation renders. */
export const DELETE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_deleteTitle%',
  '%interlinearizer_analysisCatalog_deleteBlank%',
  '%interlinearizer_analysisCatalog_deleteBlankOne%',
  '%interlinearizer_analysisCatalog_deleteBlankNone%',
  '%interlinearizer_analysisCatalog_deleteFallback%',
  '%interlinearizer_analysisCatalog_deleteFallbackOne%',
  '%interlinearizer_analysisCatalog_deleteFallbackNoGloss%',
  '%interlinearizer_analysisCatalog_deleteFallbackNoGlossOne%',
  '%interlinearizer_analysisCatalog_deleteUnapplied%',
  '%interlinearizer_analysisCatalog_deleteUnappliedOne%',
  '%interlinearizer_analysisCatalog_deleteUndoWarning%',
  '%interlinearizer_analysisCatalog_deleteCancel%',
  '%interlinearizer_analysisCatalog_deleteConfirm%',
] as const satisfies `%${string}%`[];

/**
 * States the concrete consequence of the deletion in the reader's own terms — how many uses are
 * affected and what they will read as afterwards — rather than asking a generic "are you sure".
 *
 * The cases are the outcomes the store distinguishes crossed with whether there is a word to quote:
 * a fallback whose peer carries no gloss in the active language can only be described, not named.
 * Each has a singular form, because "1 uses" reads as a bug in the sentence that has to carry an
 * irreversible decision.
 *
 * Zero uses is separated from the plural rather than left to say "0 uses will be left with no
 * analysis", which invites the reader to wonder which nothing it means. Only the blank outcome can
 * be reached with no uses, {@link selectAnalysisDeletionOutcome} reporting an unused record as blank
 * however many homographs survive it.
 */
function outcomeMessage(
  outcome: AnalysisDeletionOutcome,
  localizedStrings: LanguageStrings,
): string {
  const { kind, usageCount, fallbackGloss } = outcome;

  if (kind === 'blank') {
    if (usageCount === 0)
      return localizedStrings['%interlinearizer_analysisCatalog_deleteBlankNone%'];
    if (usageCount === 1)
      return localizedStrings['%interlinearizer_analysisCatalog_deleteBlankOne%'];
    return formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_deleteBlank%'],
      { count: usageCount },
    );
  }

  if (!fallbackGloss) {
    if (usageCount === 1)
      return localizedStrings['%interlinearizer_analysisCatalog_deleteFallbackNoGlossOne%'];
    return formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_deleteFallbackNoGloss%'],
      { count: usageCount },
    );
  }

  if (usageCount === 1)
    return formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_deleteFallbackOne%'],
      { gloss: fallbackGloss },
    );
  return formatReplacementString(
    localizedStrings['%interlinearizer_analysisCatalog_deleteFallback%'],
    { count: usageCount, gloss: fallbackGloss },
  );
}

/**
 * Names the recorded-but-unapproved assignments the deletion also destroys, or `undefined` when
 * there are none.
 */
function unappliedMessage(
  unappliedCount: number,
  localizedStrings: LanguageStrings,
): string | undefined {
  if (unappliedCount === 0) return undefined;
  if (unappliedCount === 1)
    return localizedStrings['%interlinearizer_analysisCatalog_deleteUnappliedOne%'];
  return formatReplacementString(
    localizedStrings['%interlinearizer_analysisCatalog_deleteUnapplied%'],
    { count: unappliedCount },
  );
}

/** Props for {@link CatalogDeleteModal}. */
type CatalogDeleteModalProps = Readonly<{
  /** Surface form of the analysis being deleted, named in the title. */
  surfaceText: string;
  /** What the deletion will do to the tokens that approve the analysis. */
  outcome: AnalysisDeletionOutcome;
  /** Commits the deletion. */
  onConfirm: () => void;
  /** Backs out, leaving the analysis untouched. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link DELETE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * Confirms deleting an analysis, naming what the deletion costs.
 *
 * Delete ships before undo, so this copy is the only guard: the analysis and every link to it go at
 * once — approved and not — and the tokens that carried it are left on whatever the suggestion pool
 * still offers. The modal is dismissable by Escape and by clicking outside — nothing is in flight
 * to abandon, and a confirmation that traps the reader is worse than one they can back out of.
 */
export default function CatalogDeleteModal({
  surfaceText,
  outcome,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogDeleteModalProps) {
  const unapplied = unappliedMessage(outcome.unappliedCount, localizedStrings);
  return (
    <ModalShell
      onClose={onCancel}
      title={formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_deleteTitle%'],
        { form: surfaceText },
      )}
      titleTestId="catalog-delete-title"
      width="tw:w-96"
    >
      <p className="tw:text-sm" data-testid="catalog-delete-outcome">
        {outcomeMessage(outcome, localizedStrings)}
      </p>
      {unapplied && (
        <p className="tw:mt-2 tw:text-sm" data-testid="catalog-delete-unapplied">
          {unapplied}
        </p>
      )}
      <p className="tw:mt-2 tw:text-xs tw:text-muted-foreground">
        {localizedStrings['%interlinearizer_analysisCatalog_deleteUndoWarning%']}
      </p>
      <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
        <Button data-testid="catalog-delete-cancel" onClick={onCancel} variant="outline">
          {localizedStrings['%interlinearizer_analysisCatalog_deleteCancel%']}
        </Button>
        <Button
          className="tw:text-destructive"
          data-testid="catalog-delete-confirm"
          onClick={onConfirm}
          variant="outline"
        >
          {localizedStrings['%interlinearizer_analysisCatalog_deleteConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
