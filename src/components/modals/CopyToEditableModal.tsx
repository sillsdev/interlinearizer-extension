import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { useState } from 'react';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const COPY_TO_EDITABLE_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_copyModal_title%',
  '%interlinearizer_copyModal_defaultName%',
  '%interlinearizer_copyModal_create%',
  '%interlinearizer_copyModal_cancel%',
  '%interlinearizer_modal_metadata_name_label%',
  '%interlinearizer_modal_metadata_description_label%',
];

/**
 * Dialog for copying a Paratext 9 import into an editable project: a name prefilled with the
 * localized default and an optional description. There is no languages field - the copy carries the
 * import's languages verbatim.
 *
 * @param props.isSubmitting - When `true`, the copy is being created: the buttons go inert and the
 *   modal cannot be dismissed, so the in-flight work cannot be abandoned.
 * @param props.onSubmit - Called with the trimmed name and the trimmed description (or `undefined`
 *   when blank) when the user confirms.
 * @param props.onClose - Called when the user cancels without copying.
 */
export function CopyToEditableModal({
  isSubmitting,
  onSubmit,
  onClose,
}: Readonly<{
  isSubmitting: boolean;
  onSubmit: (name: string, description?: string) => void;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(COPY_TO_EDITABLE_STRING_KEYS);
  const [name, setName] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState('');

  /* v8 ignore next */ if (stringsLoading) return undefined;

  // The prefill resolves with the strings, after the first render, so the draft name starts
  // undefined and falls back to the localized default until the user edits it.
  const nameValue = name ?? localizedStrings['%interlinearizer_copyModal_defaultName%'];

  const handleSubmit = () => {
    const trimmedName = nameValue.trim();
    const trimmedDescription = description.trim();
    onSubmit(
      trimmedName === ''
        ? localizedStrings['%interlinearizer_copyModal_defaultName%']
        : trimmedName,
      trimmedDescription === '' ? undefined : trimmedDescription,
    );
  };

  return (
    <ModalShell
      titleTestId="copy-to-editable-modal-title"
      title={localizedStrings['%interlinearizer_copyModal_title%']}
      width="tw:w-96"
      onClose={isSubmitting ? undefined : onClose}
    >
      <Label className="tw:mb-1 tw:block tw:text-sm" htmlFor="copy-to-editable-name">
        {localizedStrings['%interlinearizer_modal_metadata_name_label%']}
      </Label>
      <Input
        className="tw:mb-3"
        id="copy-to-editable-name"
        value={nameValue}
        onChange={(e) => setName(e.target.value)}
      />
      <Label className="tw:mb-1 tw:block tw:text-sm" htmlFor="copy-to-editable-description">
        {localizedStrings['%interlinearizer_modal_metadata_description_label%']}
      </Label>
      <Textarea
        className="tw:mb-4"
        id="copy-to-editable-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="tw:modal-actions">
        <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>
          {localizedStrings['%interlinearizer_copyModal_cancel%']}
        </Button>
        <Button disabled={isSubmitting} onClick={handleSubmit}>
          {localizedStrings['%interlinearizer_copyModal_create%']}
        </Button>
      </div>
    </ModalShell>
  );
}
