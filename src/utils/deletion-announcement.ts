import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { AnalysisDeletionOutcome } from './analysis-selectors';

/** The keys of the sentences that state what a deletion does, for one tense. */
type OutcomeKeys = Readonly<{
  blank: `%${string}%`;
  blankNone: `%${string}%`;
  fallback: `%${string}%`;
  fallbackNoGloss: `%${string}%`;
  fallbackUncertain: `%${string}%`;
  unapplied: `%${string}%`;
}>;

/** Sentence keys for announcing a finished deletion. */
const DONE_KEYS = {
  blank: '%interlinearizer_analysisCatalog_deleteBlank%',
  blankNone: '%interlinearizer_analysisCatalog_deleteBlankNone%',
  fallback: '%interlinearizer_analysisCatalog_deleteFallback%',
  fallbackNoGloss: '%interlinearizer_analysisCatalog_deleteFallbackNoGloss%',
  fallbackUncertain: '%interlinearizer_analysisCatalog_deleteFallbackUncertain%',
  unapplied: '%interlinearizer_analysisCatalog_deleteUnapplied%',
} as const satisfies OutcomeKeys;

/** Sentence keys for a deletion that awaits the reader's confirmation. */
const CONFIRM_KEYS = {
  blank: '%interlinearizer_analysisCatalog_deleteConfirmBlank%',
  blankNone: '%interlinearizer_analysisCatalog_deleteConfirmBlankNone%',
  fallback: '%interlinearizer_analysisCatalog_deleteConfirmFallback%',
  fallbackNoGloss: '%interlinearizer_analysisCatalog_deleteConfirmFallbackNoGloss%',
  fallbackUncertain: '%interlinearizer_analysisCatalog_deleteConfirmFallbackUncertain%',
  unapplied: '%interlinearizer_analysisCatalog_deleteConfirmUnapplied%',
} as const satisfies OutcomeKeys;

/** Localized string keys a deletion announcement is built from. */
export const DELETION_ANNOUNCEMENT_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_deleted%',
  ...Object.values(DONE_KEYS),
] as const satisfies `%${string}%`[];

/** Localized string keys a deletion preview is built from. */
export const DELETION_PREVIEW_STRING_KEYS = Object.values(CONFIRM_KEYS);

/**
 * States what the deletion does to the uses of the analysis, in the reader's own terms.
 *
 * Zero uses is a sentence of its own rather than "0 uses are left with no analysis", which invites
 * the reader to wonder which nothing it means. An uncertain fallback is described rather than
 * named, quoting a word the affected token may not read being worse than quoting none.
 */
function outcomeSentence(
  outcome: AnalysisDeletionOutcome,
  keys: OutcomeKeys,
  strings: LanguageStrings,
): string {
  const { kind, usageCount, fallbackGloss, uncertain } = outcome;
  if (kind === 'blank') {
    if (usageCount === 0) return strings[keys.blankNone];
    return formatReplacementString(strings[keys.blank], { count: usageCount });
  }
  if (uncertain)
    return formatReplacementString(strings[keys.fallbackUncertain], { count: usageCount });
  if (!fallbackGloss)
    return formatReplacementString(strings[keys.fallbackNoGloss], { count: usageCount });
  return formatReplacementString(strings[keys.fallback], {
    count: usageCount,
    gloss: fallbackGloss,
  });
}

/** What the deletion does to the analysis's uses, then the unapproved records it takes with it. */
function outcomeSentences(
  outcome: AnalysisDeletionOutcome,
  keys: OutcomeKeys,
  strings: LanguageStrings,
): string[] {
  const sentences = [outcomeSentence(outcome, keys, strings)];
  if (outcome.unappliedCount > 0)
    sentences.push(
      formatReplacementString(strings[keys.unapplied], { count: outcome.unappliedCount }),
    );
  return sentences;
}

/**
 * States what a deletion would do, for the reader to weigh before confirming it.
 *
 * @param outcome - What the deletion would do.
 * @param strings - Resolved localizations covering at least {@link DELETION_PREVIEW_STRING_KEYS}.
 */
export function deletionPreview(
  outcome: AnalysisDeletionOutcome,
  strings: LanguageStrings,
): string {
  return outcomeSentences(outcome, CONFIRM_KEYS, strings).join(' ');
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
  return [
    formatReplacementString(strings['%interlinearizer_analysisCatalog_deleted%'], { form }),
    ...outcomeSentences(outcome, DONE_KEYS, strings),
  ].join(' ');
}
