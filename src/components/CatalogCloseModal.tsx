import { Button } from 'platform-bible-react';
import type { LanguageStrings } from 'platform-bible-utils';
import { ModalShell } from './modals/ModalShell';

/** Localized string keys the close confirmation renders. */
export const CLOSE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_closeConfirmTitle%',
  '%interlinearizer_analysisCatalog_closeConfirmPrompt%',
  '%interlinearizer_analysisCatalog_closeConfirmCancel%',
  '%interlinearizer_analysisCatalog_closeConfirmDiscard%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogCloseModal}. */
type CatalogCloseModalProps = Readonly<{
  /** Closes the panel, discarding the breakdown draft. */
  onConfirm: () => void;
  /** Backs out, leaving the panel open with the draft still in hand. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link CLOSE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * Confirms closing the catalog while a breakdown draft is unsaved.
 *
 * Discarding is the only offer: saving would commit a re-segmentation that drops the old morphemes'
 * glosses for every token the record holds, which carries a confirmation of its own.
 */
export default function CatalogCloseModal({
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogCloseModalProps) {
  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings['%interlinearizer_analysisCatalog_closeConfirmTitle%']}
      titleTestId="catalog-close-title"
      width="tw:w-96"
    >
      <p className="tw:text-sm" data-testid="catalog-close-prompt">
        {localizedStrings['%interlinearizer_analysisCatalog_closeConfirmPrompt%']}
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
          {localizedStrings['%interlinearizer_analysisCatalog_closeConfirmDiscard%']}
        </Button>
      </div>
    </ModalShell>
  );
}
