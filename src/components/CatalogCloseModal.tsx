import { Button } from 'platform-bible-react';
import type { LanguageStrings } from 'platform-bible-utils';
import { ModalShell } from './modals/ModalShell';

/** Localized string keys the discard confirmation renders. */
export const CLOSE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_closeConfirmTitle%',
  '%interlinearizer_analysisCatalog_closeConfirmPrompt%',
  '%interlinearizer_analysisCatalog_closeConfirmCancel%',
  '%interlinearizer_analysisCatalog_closeConfirmDiscard%',
  '%interlinearizer_analysisCatalog_discardForDeletePrompt%',
  '%interlinearizer_analysisCatalog_discardForDeleteConfirm%',
  '%interlinearizer_analysisCatalog_discardForMergePrompt%',
  '%interlinearizer_analysisCatalog_discardForMergeConfirm%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogCloseModal}. */
type CatalogCloseModalProps = Readonly<{
  /** Goes ahead with the action, discarding the breakdown draft. */
  onConfirm: () => void;
  /** Backs out, leaving the draft in hand. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link CLOSE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** What the draft is being given up for; closing the panel when absent. */
  action?: 'merge' | 'delete';
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
} as const;

/**
 * Confirms giving up an unsaved breakdown draft — to close the catalog over it, or to merge or
 * delete the very analysis it is keyed to.
 *
 * Discarding is the only offer: saving would commit a re-segmentation that drops the old morphemes'
 * glosses for every token the record holds, which carries a confirmation of its own. Consenting
 * here settles only the draft, never the merge or delete it clears the way for.
 */
export default function CatalogCloseModal({
  onConfirm,
  onCancel,
  localizedStrings,
  action,
}: CatalogCloseModalProps) {
  const [promptKey, confirmKey] = ACTION_KEYS[action ?? 'close'];

  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings['%interlinearizer_analysisCatalog_closeConfirmTitle%']}
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
