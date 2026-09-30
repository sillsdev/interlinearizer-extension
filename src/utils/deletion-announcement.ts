import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { AnalysisDeletionOutcome } from '../store/analysisSlice';

/** Localized string keys a deletion announcement is built from. */
export const DELETION_ANNOUNCEMENT_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_deleted%',
  '%interlinearizer_analysisCatalog_deleteBlank%',
  '%interlinearizer_analysisCatalog_deleteBlankNone%',
  '%interlinearizer_analysisCatalog_deleteFallback%',
  '%interlinearizer_analysisCatalog_deleteFallbackNoGloss%',
  '%interlinearizer_analysisCatalog_deleteFallbackUncertain%',
  '%interlinearizer_analysisCatalog_deleteUnapplied%',
] as const satisfies `%${string}%`[];

/**
 * States what the deletion did to the uses of the analysis, in the reader's own terms.
 *
 * Zero uses is a sentence of its own rather than "0 uses are left with no analysis", which invites
 * the reader to wonder which nothing it means. An uncertain fallback is described rather than
 * named, quoting a word the affected token may not read being worse than quoting none.
 */
function outcomeSentence(outcome: AnalysisDeletionOutcome, strings: LanguageStrings): string {
  const { kind, usageCount, fallbackGloss, uncertain } = outcome;
  if (kind === 'blank') {
    if (usageCount === 0) return strings['%interlinearizer_analysisCatalog_deleteBlankNone%'];
    return formatReplacementString(strings['%interlinearizer_analysisCatalog_deleteBlank%'], {
      count: usageCount,
    });
  }
  if (uncertain)
    return formatReplacementString(
      strings['%interlinearizer_analysisCatalog_deleteFallbackUncertain%'],
      { count: usageCount },
    );
  if (!fallbackGloss)
    return formatReplacementString(
      strings['%interlinearizer_analysisCatalog_deleteFallbackNoGloss%'],
      { count: usageCount },
    );
  return formatReplacementString(strings['%interlinearizer_analysisCatalog_deleteFallback%'], {
    count: usageCount,
    gloss: fallbackGloss,
  });
}

/**
 * Announces a deletion: that it happened, what it did to the analysis's uses, and the unapproved
 * records it took with it.
 *
 * @param form - Surface form of the deleted analysis.
 * @param outcome - What the deletion did, as read just before it.
 * @param strings - Resolved localizations covering at least
 *   {@link DELETION_ANNOUNCEMENT_STRING_KEYS}.
 */
export function deletionAnnouncement(
  form: string,
  outcome: AnalysisDeletionOutcome,
  strings: LanguageStrings,
): string {
  const sentences = [
    formatReplacementString(strings['%interlinearizer_analysisCatalog_deleted%'], { form }),
    outcomeSentence(outcome, strings),
  ];
  if (outcome.unappliedCount > 0)
    sentences.push(
      formatReplacementString(strings['%interlinearizer_analysisCatalog_deleteUnapplied%'], {
        count: outcome.unappliedCount,
      }),
    );
  return sentences.join(' ');
}
