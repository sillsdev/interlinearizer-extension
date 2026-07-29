import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Label, RadioGroup, RadioGroupItem } from 'platform-bible-react';
import { useState } from 'react';
import { ModalShell } from './ModalShell';

/** The portion of the draft a wipe removes: the current book only, or the entire draft. */
export type WipeScope = 'book' | 'all';

/** Localized string keys used by {@link WipeModal}. */
const WIPE_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_wipe_modal_title%',
  '%interlinearizer_wipe_modal_prompt%',
  '%interlinearizer_wipe_modal_scope_book%',
  '%interlinearizer_wipe_modal_scope_book_description%',
  '%interlinearizer_wipe_modal_scope_all%',
  '%interlinearizer_wipe_modal_scope_all_description%',
  '%interlinearizer_wipe_modal_confirm%',
  '%interlinearizer_wipe_modal_cancel%',
];

/**
 * Destructive draft-wipe dialog. Lets the user choose whether to remove the analysis for just the
 * current book or for the entire draft, then confirm. Confirming removes the chosen analysis from
 * the draft (which auto-saves); the user can then Save to persist the change to a project. This
 * component is presentational — it collects the scope and hands it back via {@link onConfirm}; the
 * caller performs the actual wipe.
 *
 * @param props - Component props
 * @param props.hasActiveBook - Whether a book is currently loaded. When `false`, the "current book"
 *   option is disabled and the selection defaults to the whole draft, since there is no book to
 *   wipe.
 * @param props.onConfirm - Called with the chosen {@link WipeScope} when the user confirms.
 * @param props.onCancel - Called when the user backs out, leaving the draft untouched.
 * @returns The wipe dialog overlay, or nothing while localized strings are loading.
 */
export function WipeModal({
  hasActiveBook,
  onConfirm,
  onCancel,
}: Readonly<{
  hasActiveBook: boolean;
  onConfirm: (scope: WipeScope) => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(WIPE_MODAL_STRING_KEYS);

  // Default to the safer, more common per-book wipe when a book is loaded; otherwise the whole
  // draft is the only actionable choice.
  const [scope, setScope] = useState<WipeScope>(hasActiveBook ? 'book' : 'all');

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleId="wipe-modal-title"
      title={localizedStrings['%interlinearizer_wipe_modal_title%']}
      width="tw:w-96"
      onClose={onCancel}
    >
      <p className="tw:text-sm tw:mb-4">
        {localizedStrings['%interlinearizer_wipe_modal_prompt%']}
      </p>

      <RadioGroup
        className="tw:mb-4 tw:gap-3"
        onValueChange={(value) => setScope(value === 'book' ? 'book' : 'all')}
        value={scope}
      >
        <div className="tw:flex tw:flex-col tw:gap-0.5 tw:text-sm">
          <div className="tw:flex tw:gap-2 tw:items-center tw:font-medium">
            <RadioGroupItem
              data-testid="wipe-scope-book"
              disabled={!hasActiveBook}
              id="wipe-scope-book"
              value="book"
            />
            <Label htmlFor="wipe-scope-book">
              {localizedStrings['%interlinearizer_wipe_modal_scope_book%']}
            </Label>
          </div>
          <span className="tw:ps-6 tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_wipe_modal_scope_book_description%']}
          </span>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-0.5 tw:text-sm">
          <div className="tw:flex tw:gap-2 tw:items-center tw:font-medium">
            <RadioGroupItem data-testid="wipe-scope-all" id="wipe-scope-all" value="all" />
            <Label htmlFor="wipe-scope-all">
              {localizedStrings['%interlinearizer_wipe_modal_scope_all%']}
            </Label>
          </div>
          <span className="tw:ps-6 tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_wipe_modal_scope_all_description%']}
          </span>
        </div>
      </RadioGroup>

      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel}>
          {localizedStrings['%interlinearizer_wipe_modal_cancel%']}
        </Button>
        <Button variant="destructive" onClick={() => onConfirm(scope)} data-testid="wipe-confirm">
          {localizedStrings['%interlinearizer_wipe_modal_confirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
