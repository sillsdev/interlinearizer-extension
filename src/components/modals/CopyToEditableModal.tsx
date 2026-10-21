import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useState } from 'react';
import useProjectsForSource from '../../hooks/useProjectsForSource';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const COPY_TO_EDITABLE_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_copyModal_title%',
  '%interlinearizer_copyModal_defaultName%',
  '%interlinearizer_copyModal_defaultNameNumbered%',
  '%interlinearizer_copyModal_create%',
  '%interlinearizer_copyModal_cancel%',
  '%interlinearizer_modal_metadata_name_label%',
  '%interlinearizer_modal_metadata_description_label%',
];

/**
 * Returns `defaultName` when none of `takenNames` matches it, else the first fill of
 * `numberedTemplate`'s `{number}` placeholder, counting from 2, that none matches.
 */
function uniqueDefaultName(
  takenNames: ReadonlySet<string | undefined>,
  defaultName: string,
  numberedTemplate: string,
): string {
  let candidate = defaultName;
  for (let number = 2; takenNames.has(candidate); number += 1)
    candidate = formatReplacementString(numberedTemplate, { number });
  return candidate;
}

/**
 * Dialog for copying a Paratext 9 import into an editable project: a name and an optional
 * description. The name is prefilled with a default that no project in the source's loaded list
 * bears, or with the unnumbered default when the list fails to load. There is no languages field -
 * the copy carries the import's languages verbatim.
 *
 * @param props.sourceProjectId - Platform.Bible project ID the import, and so the copy, belongs to.
 * @param props.isSubmitting - When `true`, the copy is being created: the buttons go inert and the
 *   modal cannot be dismissed, so the in-flight work cannot be abandoned.
 * @param props.onSubmit - Called with the trimmed name and the trimmed description (or `undefined`
 *   when blank) when the user confirms.
 * @param props.onClose - Called when the user cancels without copying.
 */
export function CopyToEditableModal({
  sourceProjectId,
  isSubmitting,
  onSubmit,
  onClose,
}: Readonly<{
  sourceProjectId: string;
  isSubmitting: boolean;
  onSubmit: (name: string, description?: string) => void;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(COPY_TO_EDITABLE_STRING_KEYS);
  const [name, setName] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState('');
  const { projects, isLoading } = useProjectsForSource(sourceProjectId);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const defaultName = uniqueDefaultName(
    new Set(projects.map((project) => project.name)),
    localizedStrings['%interlinearizer_copyModal_defaultName%'],
    localizedStrings['%interlinearizer_copyModal_defaultNameNumbered%'],
  );
  // The prefill resolves with the strings and the project list, after the first render, so the
  // draft name starts undefined and falls back to the default until the user edits it.
  const nameValue = name ?? defaultName;

  const handleSubmit = () => {
    const trimmedName = nameValue.trim();
    const trimmedDescription = description.trim();
    onSubmit(
      trimmedName === '' ? defaultName : trimmedName,
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
        <Button disabled={isSubmitting || isLoading} onClick={handleSubmit}>
          {localizedStrings['%interlinearizer_copyModal_create%']}
        </Button>
      </div>
    </ModalShell>
  );
}
