import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Trash2 } from 'lucide-react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { useCallback, useMemo, useState } from 'react';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import { parseLanguageTags } from '../../utils/language-tags';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const PROJECT_METADATA_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_metadata_title%',
  '%interlinearizer_modal_metadata_id_label%',
  '%interlinearizer_modal_metadata_name_label%',
  '%interlinearizer_modal_metadata_name_placeholder%',
  '%interlinearizer_modal_metadata_description_label%',
  '%interlinearizer_modal_metadata_description_placeholder%',
  '%interlinearizer_modal_metadata_analysis_language_label%',
  '%interlinearizer_modal_metadata_language_placeholder%',
  '%interlinearizer_modal_metadata_created_label%',
  '%interlinearizer_modal_metadata_modified_label%',
  '%interlinearizer_modal_metadata_source_label%',
  '%interlinearizer_modal_metadata_save%',
  '%interlinearizer_modal_metadata_close%',
  '%interlinearizer_modal_metadata_delete%',
  '%interlinearizer_modal_metadata_delete_confirm_title%',
  '%interlinearizer_modal_metadata_delete_confirm_body%',
  '%interlinearizer_modal_metadata_delete_confirm_ok%',
  '%interlinearizer_modal_metadata_delete_confirm_cancel%',
];

/** Props for {@link ProjectMetadataModal}. */
type ProjectMetadataModalProps = Readonly<{
  /** UUID of the active interlinearizer project. */
  interlinearProjectId: string;
  /** Optional user-facing name of the project. */
  name?: string;
  /** Optional user-facing description of the project. */
  description?: string;
  /** Platform.Bible project ID of the source text. */
  sourceProjectId: string;
  /** Optional Platform.Bible project ID of the target text for bilateral alignment projects. */
  targetProjectId?: string;
  /** BCP 47 tags for the analysis languages. */
  analysisLanguages: string[];
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent modification. */
  updatedAt: string;
  /** Callback invoked when the modal should be dismissed without saving. */
  onClose: () => void;
  /** Optional callback invoked with updated metadata after a successful save. */
  onProjectSaved?: (updated: {
    name?: string;
    description?: string;
    analysisLanguages: string[];
    updatedAt?: string;
  }) => void;
  /** Optional callback invoked with the deleted project ID after deletion. */
  onProjectDeleted?: (deletedProjectId: string) => void;
}>;

/**
 * Modal that displays and allows editing of the active interlinearizer project's metadata. Editable
 * fields are name, description, and analysis language. Read-only fields are project ID, creation
 * date, and source project. Includes an inline delete-with-confirmation flow.
 */
export function ProjectMetadataModal({
  interlinearProjectId,
  name,
  description,
  sourceProjectId,
  targetProjectId,
  analysisLanguages,
  createdAt,
  updatedAt,
  onClose,
  onProjectSaved,
  onProjectDeleted,
}: ProjectMetadataModalProps) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    PROJECT_METADATA_MODAL_STRING_KEYS,
  );

  const [editName, setEditName] = useState(name ?? '');
  const [editDescription, setEditDescription] = useState(description ?? '');
  const [editLanguages, setEditLanguages] = useState(analysisLanguages.join(', '));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Guards Save/Delete against double-submit; `isSubmitting` disables the controls while one runs.
  const { isSubmitting, runGuarded } = useSubmitGuard();

  const formattedDate = useMemo(() => new Date(createdAt).toLocaleString(), [createdAt]);
  const formattedModifiedDate = useMemo(() => new Date(updatedAt).toLocaleString(), [updatedAt]);

  /**
   * Parsed analysis-language tags from the comma-separated field. Parsed once per edit, so every
   * decision that depends on the tags sees the same list.
   */
  const parsedLanguages = useMemo(() => parseLanguageTags(editLanguages), [editLanguages]);

  /**
   * Sends the updated name, description, and analysis languages to the backend, then notifies the
   * caller and closes the modal. Logs on failure; the backend command handler is responsible for
   * showing the error notification so this handler does not re-send it.
   *
   * The analysis-languages input is interpreted as a comma-separated list of BCP 47 tags; entries
   * are trimmed and empty entries dropped. Save is disabled when the parsed list is empty since
   * `analysisLanguages` is required and must not be cleared.
   */
  const handleSave = useCallback(
    () =>
      runGuarded(async () => {
        const newName = editName.trim() || undefined;
        const newDescription = editDescription.trim() || undefined;
        try {
          const updatedProjectJson = await papi.commands.sendCommand(
            'interlinearizer.updateProjectMetadata',
            interlinearProjectId,
            newName,
            newDescription,
            parsedLanguages,
            targetProjectId,
          );
          if (!updatedProjectJson) return;
          // Parse the refreshed `updatedAt` out of the returned project so the caller's cached copy
          // shows the new Modified time; omit it defensively if the payload is unexpectedly shaped.
          const parsed: unknown = JSON.parse(updatedProjectJson);
          const rawUpdatedAt =
            parsed && typeof parsed === 'object' && 'updatedAt' in parsed
              ? parsed.updatedAt
              : undefined;
          const refreshedUpdatedAt = typeof rawUpdatedAt === 'string' ? rawUpdatedAt : undefined;
          onProjectSaved?.({
            name: newName,
            description: newDescription,
            analysisLanguages: parsedLanguages,
            ...(refreshedUpdatedAt !== undefined && { updatedAt: refreshedUpdatedAt }),
          });
          onClose();
        } catch (e) {
          logger.error('Interlinearizer: failed to save project metadata', e);
        }
      }),
    [
      editName,
      editDescription,
      parsedLanguages,
      interlinearProjectId,
      targetProjectId,
      onProjectSaved,
      onClose,
      runGuarded,
    ],
  );

  /**
   * Sends the delete command to the backend, then notifies the caller and closes the modal. Logs on
   * failure; the backend command handler is responsible for showing the error notification so this
   * handler does not re-send it.
   */
  const handleDelete = useCallback(
    () =>
      runGuarded(async () => {
        try {
          await papi.commands.sendCommand('interlinearizer.deleteProject', interlinearProjectId);
          onProjectDeleted?.(interlinearProjectId);
          onClose();
        } catch (e) {
          logger.error('Interlinearizer: failed to delete project', e);
        }
      }),
    [interlinearProjectId, onProjectDeleted, onClose, runGuarded],
  );

  /**
   * Escape backs out one layer at a time: an armed delete confirmation collapses first, so a
   * keypress aimed at that box does not also discard the edits typed into the fields behind it. A
   * second Escape then closes the modal.
   */
  const handleDismiss = useCallback(() => {
    if (confirmingDelete) setConfirmingDelete(false);
    else onClose();
  }, [confirmingDelete, onClose]);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="project-metadata-modal-title"
      title={localizedStrings['%interlinearizer_modal_metadata_title%']}
      width="tw:w-lg"
      onClose={isSubmitting ? undefined : handleDismiss}
    >
      {/* Editable fields */}
      <div className="tw:flex tw:flex-col tw:gap-3 tw:mb-4">
        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label className="tw:section-label" htmlFor="metadata-edit-name">
            {localizedStrings['%interlinearizer_modal_metadata_name_label%']}
          </Label>
          <Input
            id="metadata-edit-name"
            className="tw:modal-metadata-input"
            value={editName}
            placeholder={localizedStrings['%interlinearizer_modal_metadata_name_placeholder%']}
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label className="tw:section-label" htmlFor="metadata-edit-description">
            {localizedStrings['%interlinearizer_modal_metadata_description_label%']}
          </Label>
          <Textarea
            id="metadata-edit-description"
            className="tw:modal-metadata-input tw:resize-none"
            rows={2}
            value={editDescription}
            placeholder={
              localizedStrings['%interlinearizer_modal_metadata_description_placeholder%']
            }
            onChange={(e) => setEditDescription(e.target.value)}
          />
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label className="tw:section-label" htmlFor="metadata-edit-language">
            {localizedStrings['%interlinearizer_modal_metadata_analysis_language_label%']}
          </Label>
          <Input
            id="metadata-edit-language"
            className="tw:modal-metadata-input tw:font-mono"
            value={editLanguages}
            placeholder={localizedStrings['%interlinearizer_modal_metadata_language_placeholder%']}
            onChange={(e) => setEditLanguages(e.target.value)}
          />
        </div>
      </div>

      {/* Read-only metadata */}
      <dl className="tw:flex tw:flex-col tw:gap-2 tw:mb-5">
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_id_label%']}
          value={interlinearProjectId}
          mono
        />
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_created_label%']}
          value={formattedDate}
        />
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_modified_label%']}
          value={formattedModifiedDate}
        />
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_source_label%']}
          value={sourceProjectId}
          mono
        />
      </dl>

      {/* Footer */}
      {confirmingDelete ? (
        <div className="tw:modal-error-box tw:px-3 tw:py-2">
          <p className="tw:font-medium tw:text-foreground tw:mb-0.5">
            {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_title%']}
          </p>
          <p className="tw:text-xs tw:text-muted-foreground tw:mb-2">
            {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_body%']}
          </p>
          <div className="tw:modal-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
              disabled={isSubmitting}
            >
              {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_cancel%']}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isSubmitting}>
              {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_ok%']}
            </Button>
          </div>
        </div>
      ) : (
        <div className="tw:flex tw:gap-2 tw:justify-between">
          <Button
            variant="destructive"
            onClick={() => setConfirmingDelete(true)}
            disabled={isSubmitting}
          >
            <Trash2 className="tw:mr-1 tw:size-[13px]" />
            {localizedStrings['%interlinearizer_modal_metadata_delete%']}
          </Button>
          <div className="tw:flex tw:gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {localizedStrings['%interlinearizer_modal_metadata_close%']}
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting || parsedLanguages.length === 0}>
              {localizedStrings['%interlinearizer_modal_metadata_save%']}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

/**
 * A single label/value row inside the read-only metadata description list.
 *
 * @param props.label - Localized field label shown as `<dt>`.
 * @param props.value - Value string shown as `<dd>`.
 * @param props.mono - When true, renders the value in a monospace font.
 */
function MetadataRow({
  label,
  value,
  mono,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="tw:flex tw:flex-col tw:gap-0.5">
      <dt className="tw:section-label">{label}</dt>
      <dd
        className={['tw:text-sm tw:break-all tw:text-foreground', mono ? 'tw:font-mono' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
