import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useStaleFreeTranslationDispatch } from './AnalysisStore';
import { verseLabelOf, type StaleFreeTranslation } from '../utils/stale-free-translations';

/** Localized string keys {@link OrphanedFreeTranslationCard} reads from the strings it is handed. */
export const ORPHANED_CARD_STRING_KEYS = [
  '%interlinearizer_freeTranslationInput_orphaned%',
  '%interlinearizer_freeTranslationInput_staleDiscard%',
  '%interlinearizer_freeTranslationInput_staleNoText%',
] as const satisfies `%${string}%`[];

type OrphanedFreeTranslationCardProps = Readonly<{
  translation: StaleFreeTranslation;
  /** Resolved {@link ORPHANED_CARD_STRING_KEYS}, supplied rather than subscribed to per card. */
  localizedStrings: LanguageStrings;
}>;

/**
 * A stale free translation of a verse the book no longer holds, shown as an item of its own in the
 * segment list. It offers only Discard, since no segment remains to keep it for.
 */
export default function OrphanedFreeTranslationCard({
  translation,
  localizedStrings,
}: OrphanedFreeTranslationCardProps) {
  const { discard } = useStaleFreeTranslationDispatch();
  return (
    <div
      className="tw:flex tw:w-full tw:flex-col tw:gap-1 tw:rounded tw:border tw:border-dashed tw:border-border tw:p-2 tw:text-sm"
      data-analysis-id={translation.analysisId}
      data-testid="orphaned-free-translation"
    >
      <span className="tw:text-xs tw:gloss-stale">
        {formatReplacementString(
          localizedStrings['%interlinearizer_freeTranslationInput_orphaned%'],
          { verse: verseLabelOf(translation.segmentId) },
        )}
      </span>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1">
        <span className="tw:gloss-stale">
          {translation.text ||
            localizedStrings['%interlinearizer_freeTranslationInput_staleNoText%']}
        </span>
        <Button
          data-testid="orphaned-free-translation-discard"
          onClick={() => discard(translation.analysisId)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {localizedStrings['%interlinearizer_freeTranslationInput_staleDiscard%']}
        </Button>
      </div>
    </div>
  );
}
