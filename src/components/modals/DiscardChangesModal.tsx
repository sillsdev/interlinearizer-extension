import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Label, RadioGroup, RadioGroupItem } from 'platform-bible-react';
import { useState } from 'react';
import { ModalShell } from './ModalShell';

/** The portion of the draft a discard covers: the current book only, or the entire draft. */
export type DiscardScope = 'book' | 'all';

/** Localized string keys requested for this modal's rendered text. */
const DISCARD_CHANGES_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_discardChanges_modal_title%',
  '%interlinearizer_discardChanges_modal_prompt%',
  '%interlinearizer_discardChanges_modal_scope_book%',
  '%interlinearizer_discardChanges_modal_scope_book_description%',
  '%interlinearizer_discardChanges_modal_scope_all%',
  '%interlinearizer_discardChanges_modal_scope_all_description%',
  '%interlinearizer_discardChanges_modal_confirm%',
  '%interlinearizer_discardChanges_modal_cancel%',
];

/**
 * Dialog that asks how much of the draft's unsaved analysis to discard: the current book's or the
 * entire draft's. It only collects the scope; the caller does the discarding.
 *
 * @param props.hasActiveBook - Whether a book is currently loaded. When `false`, the "current book"
 *   option is disabled and the selection defaults to the whole draft.
 * @param props.onConfirm - Called with the chosen {@link DiscardScope} when the user confirms.
 * @param props.onCancel - Called when the user backs out, leaving the draft untouched.
 * @returns The dialog, or nothing while localized strings are loading.
 */
export function DiscardChangesModal({
  hasActiveBook,
  onConfirm,
  onCancel,
}: Readonly<{
  hasActiveBook: boolean;
  onConfirm: (scope: DiscardScope) => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(DISCARD_CHANGES_MODAL_STRING_KEYS);

  // Default to the narrower per-book discard when a book is loaded; otherwise the whole draft is
  // the only actionable choice.
  const [scope, setScope] = useState<DiscardScope>(hasActiveBook ? 'book' : 'all');

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="discard-changes-modal-title"
      title={localizedStrings['%interlinearizer_discardChanges_modal_title%']}
      width="tw:w-96"
      onClose={onCancel}
    >
      <p className="tw:text-sm tw:mb-4">
        {localizedStrings['%interlinearizer_discardChanges_modal_prompt%']}
      </p>

      <RadioGroup
        className="tw:mb-4 tw:gap-3"
        onValueChange={(value) => setScope(value === 'book' ? 'book' : 'all')}
        value={scope}
      >
        <div className="tw:flex tw:flex-col tw:gap-0.5 tw:text-sm">
          <div className="tw:flex tw:gap-2 tw:items-center tw:font-medium">
            <RadioGroupItem
              data-testid="discard-changes-scope-book"
              disabled={!hasActiveBook}
              id="discard-changes-scope-book"
              value="book"
            />
            <Label htmlFor="discard-changes-scope-book">
              {localizedStrings['%interlinearizer_discardChanges_modal_scope_book%']}
            </Label>
          </div>
          <span className="tw:ps-6 tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_discardChanges_modal_scope_book_description%']}
          </span>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-0.5 tw:text-sm">
          <div className="tw:flex tw:gap-2 tw:items-center tw:font-medium">
            <RadioGroupItem
              data-testid="discard-changes-scope-all"
              id="discard-changes-scope-all"
              value="all"
            />
            <Label htmlFor="discard-changes-scope-all">
              {localizedStrings['%interlinearizer_discardChanges_modal_scope_all%']}
            </Label>
          </div>
          <span className="tw:ps-6 tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_discardChanges_modal_scope_all_description%']}
          </span>
        </div>
      </RadioGroup>

      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel}>
          {localizedStrings['%interlinearizer_discardChanges_modal_cancel%']}
        </Button>
        <Button
          variant="destructive"
          onClick={() => onConfirm(scope)}
          data-testid="discard-changes-confirm"
        >
          {localizedStrings['%interlinearizer_discardChanges_modal_confirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
