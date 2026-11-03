import { Button } from 'platform-bible-react';
import type { LanguageStrings } from 'platform-bible-utils';
import { ModalShell } from './modals/ModalShell';

/** Localized string keys the discard confirmation renders. */
export const CLOSE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_closeConfirmTitle%',
  '%interlinearizer_analysisCatalog_leaveConfirmTitle%',
  '%interlinearizer_analysisCatalog_closeConfirmPrompt%',
  '%interlinearizer_analysisCatalog_closeConfirmCancel%',
  '%interlinearizer_analysisCatalog_closeConfirmDiscard%',
  '%interlinearizer_analysisCatalog_discardForDeletePrompt%',
  '%interlinearizer_analysisCatalog_discardForDeleteConfirm%',
  '%interlinearizer_analysisCatalog_discardForMergePrompt%',
  '%interlinearizer_analysisCatalog_discardForMergeConfirm%',
  '%interlinearizer_analysisCatalog_discardForSwitchPrompt%',
  '%interlinearizer_analysisCatalog_discardForSwitchConfirm%',
  '%interlinearizer_analysisCatalog_discardForStalePrompt%',
  '%interlinearizer_analysisCatalog_discardForStaleConfirm%',
  '%interlinearizer_analysisCatalog_discardForClearGlossPrompt%',
  '%interlinearizer_analysisCatalog_discardForClearGlossConfirm%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogCloseModal}. */
type CatalogCloseModalProps = Readonly<{
  /** Goes ahead with the action, discarding the unsaved work. */
  onConfirm: () => void;
  /** Backs out, leaving the draft in hand. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link CLOSE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /**
   * What the unsaved work is being given up for; closing the panel when absent. Leaving the panel,
   * by closing or switching, gives up failed glosses as well as a breakdown draft; every other
   * action gives up only its row's breakdown draft.
   */
  action?: 'merge' | 'delete' | 'switch' | 'stale' | 'clearGloss';
}>;

/** The prompt and confirm-button keys naming what the draft is being given up for. */
const ACTION_KEYS = {
  close: [
    '%interlinearizer_analysisCatalog_closeConfirmPrompt%',
    '%interlinearizer_analysisCatalog_closeConfirmDiscard%',
  ],
  delete: [
    '%interlinearizer_analysisCatalog_discardForDeletePrompt%',
    '%interlinearizer_analysisCatalog_discardForDeleteConfirm%',
  ],
  merge: [
    '%interlinearizer_analysisCatalog_discardForMergePrompt%',
    '%interlinearizer_analysisCatalog_discardForMergeConfirm%',
  ],
  switch: [
    '%interlinearizer_analysisCatalog_discardForSwitchPrompt%',
    '%interlinearizer_analysisCatalog_discardForSwitchConfirm%',
  ],
  stale: [
    '%interlinearizer_analysisCatalog_discardForStalePrompt%',
    '%interlinearizer_analysisCatalog_discardForStaleConfirm%',
  ],
  clearGloss: [
    '%interlinearizer_analysisCatalog_discardForClearGlossPrompt%',
    '%interlinearizer_analysisCatalog_discardForClearGlossConfirm%',
  ],
} as const;

/**
 * Confirms giving up unsaved work to close or switch away from the catalog, or for an edit that
 * drops the analysis a breakdown draft is keyed to.
 *
 * Discarding is the only offer. Saving a breakdown would commit a re-segmentation that drops the
 * old morphemes' glosses for every token the record holds, which carries a confirmation of its own.
 * Consenting here settles only the draft, never the edit it clears the way for.
 */
export default function CatalogCloseModal({
  onConfirm,
  onCancel,
  localizedStrings,
  action,
}: CatalogCloseModalProps) {
  const [promptKey, confirmKey] = ACTION_KEYS[action ?? 'close'];
  const titleKey =
    action === undefined || action === 'switch'
      ? '%interlinearizer_analysisCatalog_leaveConfirmTitle%'
      : '%interlinearizer_analysisCatalog_closeConfirmTitle%';

  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings[titleKey]}
      titleTestId="catalog-close-title"
      width="tw:w-96"
    >
      <p className="tw:text-sm" data-testid="catalog-close-prompt">
        {localizedStrings[promptKey]}
      </p>
      <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
        <Button data-testid="catalog-close-cancel" onClick={onCancel} variant="outline">
          {localizedStrings['%interlinearizer_analysisCatalog_closeConfirmCancel%']}
        </Button>
        <Button
          className="tw:text-destructive"
          data-testid="catalog-close-discard"
          onClick={onConfirm}
          variant="outline"
        >
          {localizedStrings[confirmKey]}
        </Button>
      </div>
    </ModalShell>
  );
}
