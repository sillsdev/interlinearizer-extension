import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Trash2 } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { useCallback, useMemo, useState } from 'react';

/** Localized string keys used by {@link ProjectMetadataModal}. */
const PROJECT_METADATA_MODAL_STRING_KEYS = [
  '%interlinearizer_modal_metadata_title%',
  '%interlinearizer_modal_metadata_id_label%',
  '%interlinearizer_modal_metadata_name_label%',
  '%interlinearizer_modal_metadata_name_placeholder%',
  '%interlinearizer_modal_metadata_description_label%',
  '%interlinearizer_modal_metadata_description_placeholder%',
  '%interlinearizer_modal_metadata_analysis_language_label%',
  '%interlinearizer_modal_metadata_language_placeholder%',
  '%interlinearizer_modal_metadata_created_label%',
  '%interlinearizer_modal_metadata_source_label%',
  '%interlinearizer_modal_metadata_save%',
  '%interlinearizer_modal_metadata_close%',
  '%interlinearizer_modal_metadata_delete%',
  '%interlinearizer_modal_metadata_delete_confirm_title%',
  '%interlinearizer_modal_metadata_delete_confirm_body%',
  '%interlinearizer_modal_metadata_delete_confirm_ok%',
  '%interlinearizer_modal_metadata_delete_confirm_cancel%',
] as const;

/** Props for {@link ProjectMetadataModal}. */
export type ProjectMetadataModalProps = Readonly<{
  /** UUID of the active interlinearizer project. */
  interlinearProjectId: string;
  /** Optional user-facing name of the project. */
  name?: string;
  /** Optional user-facing description of the project. */
  description?: string;
  /** Platform.Bible project ID of the source text. */
  sourceProjectId: string;
  /** BCP 47 tag for the analysis language. */
  analysisWritingSystem: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Callback invoked when the modal should be dismissed without saving. */
  onClose: () => void;
  /** Optional callback invoked with updated metadata after a successful save. */
  onProjectSaved?: (updated: {
    name?: string;
    description?: string;
    analysisWritingSystem: string;
  }) => void;
  /** Optional callback invoked with the deleted project ID after deletion. */
  onProjectDeleted?: (deletedProjectId: string) => void;
}>;

/**
 * Modal that displays and allows editing of the active interlinearizer project's metadata. Editable
 * fields are name, description, and analysis language. Read-only fields are project ID, creation
 * date, and source project. Includes an inline delete-with-confirmation flow.
 *
 * @param props - Component props (see {@link ProjectMetadataModalProps}).
 * @returns The modal overlay with editable metadata fields and action buttons.
 */
export function ProjectMetadataModal({
  interlinearProjectId,
  name,
  description,
  sourceProjectId,
  analysisWritingSystem,
  createdAt,
  onClose,
  onProjectSaved,
  onProjectDeleted,
}: ProjectMetadataModalProps) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    useMemo(() => [...PROJECT_METADATA_MODAL_STRING_KEYS], []),
  );

  const [editName, setEditName] = useState(name ?? '');
  const [editDescription, setEditDescription] = useState(description ?? '');
  const [editLanguage, setEditLanguage] = useState(analysisWritingSystem);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const formattedDate = useMemo(() => new Date(createdAt).toLocaleString(), [createdAt]);

  /**
   * Sends the updated name, description, and analysis language to the backend, then notifies the
   * caller and closes the modal. Logs and shows a notification on failure.
   *
   * @returns A promise that resolves when the command completes or the error notification is sent.
   */
  const handleSave = useCallback(async () => {
    const newName = editName || undefined;
    const newDescription = editDescription || undefined;
    const newLanguage = editLanguage.trim();
    try {
      await papi.commands.sendCommand(
        'interlinearizer.updateProjectMetadata',
        interlinearProjectId,
        newName,
        newDescription,
        newLanguage,
      );
      onProjectSaved?.({
        name: newName,
        description: newDescription,
        analysisWritingSystem: newLanguage,
      });
      onClose();
    } catch (e) {
      logger.error('Interlinearizer: failed to save project metadata', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_save_metadata_failed%', severity: 'error' })
        .catch(() => {});
    }
  }, [editName, editDescription, editLanguage, interlinearProjectId, onProjectSaved, onClose]);

  /**
   * Sends the delete command to the backend, then notifies the caller and closes the modal. Logs
   * and shows a notification on failure.
   *
   * @returns A promise that resolves when the command completes or the error notification is sent.
   */
  const handleDelete = useCallback(async () => {
    try {
      await papi.commands.sendCommand('interlinearizer.deleteProject', interlinearProjectId);
      onProjectDeleted?.(interlinearProjectId);
      onClose();
    } catch (e) {
      logger.error('Interlinearizer: failed to delete project', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_delete_project_failed%', severity: 'error' })
        .catch(() => {});
    }
  }, [interlinearProjectId, onProjectDeleted, onClose]);

  if (stringsLoading) return undefined;

  return (
    <div className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-black/40">
      <div className="tw-bg-background tw-rounded-lg tw-border tw-border-border tw-p-6 tw-w-[32rem] tw-shadow-lg">
        <h2 className="tw-text-base tw-font-semibold tw-mb-4">
          {localizedStrings['%interlinearizer_modal_metadata_title%']}
        </h2>

        {/* Editable fields */}
        <div className="tw-flex tw-flex-col tw-gap-3 tw-mb-4">
          <div className="tw-flex tw-flex-col tw-gap-1">
            <label
              className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide"
              htmlFor="metadata-edit-name"
            >
              {localizedStrings['%interlinearizer_modal_metadata_name_label%']}
            </label>
            <input
              id="metadata-edit-name"
              className="tw-rounded tw-border tw-border-border tw-bg-background tw-px-2 tw-py-1 tw-text-sm tw-text-foreground"
              value={editName}
              placeholder={localizedStrings['%interlinearizer_modal_metadata_name_placeholder%']}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1">
            <label
              className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide"
              htmlFor="metadata-edit-description"
            >
              {localizedStrings['%interlinearizer_modal_metadata_description_label%']}
            </label>
            <textarea
              id="metadata-edit-description"
              className="tw-rounded tw-border tw-border-border tw-bg-background tw-px-2 tw-py-1 tw-text-sm tw-text-foreground tw-resize-none"
              rows={2}
              value={editDescription}
              placeholder={
                localizedStrings['%interlinearizer_modal_metadata_description_placeholder%']
              }
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1">
            <label
              className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide"
              htmlFor="metadata-edit-language"
            >
              {localizedStrings['%interlinearizer_modal_metadata_analysis_language_label%']}
            </label>
            <input
              id="metadata-edit-language"
              className="tw-rounded tw-border tw-border-border tw-bg-background tw-px-2 tw-py-1 tw-text-sm tw-text-foreground tw-font-mono"
              value={editLanguage}
              placeholder={
                localizedStrings['%interlinearizer_modal_metadata_language_placeholder%']
              }
              onChange={(e) => setEditLanguage(e.target.value)}
            />
          </div>
        </div>

        {/* Read-only metadata */}
        <dl className="tw-flex tw-flex-col tw-gap-2 tw-mb-5">
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
            label={localizedStrings['%interlinearizer_modal_metadata_source_label%']}
            value={sourceProjectId}
            mono
          />
        </dl>

        {/* Footer */}
        {confirmingDelete ? (
          <div className="tw-rounded tw-border tw-border-destructive/40 tw-bg-destructive/5 tw-px-3 tw-py-2">
            <p className="tw-font-medium tw-text-foreground tw-mb-0.5">
              {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_title%']}
            </p>
            <p className="tw-text-xs tw-text-muted-foreground tw-mb-2">
              {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_body%']}
            </p>
            <div className="tw-flex tw-gap-2 tw-justify-end">
              <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_cancel%']}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                {localizedStrings['%interlinearizer_modal_metadata_delete_confirm_ok%']}
              </Button>
            </div>
          </div>
        ) : (
          <div className="tw-flex tw-gap-2 tw-justify-between">
            <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={13} className="tw-mr-1" />
              {localizedStrings['%interlinearizer_modal_metadata_delete%']}
            </Button>
            <div className="tw-flex tw-gap-2">
              <Button variant="secondary" onClick={onClose}>
                {localizedStrings['%interlinearizer_modal_metadata_close%']}
              </Button>
              <Button onClick={handleSave} disabled={!editLanguage.trim()}>
                {localizedStrings['%interlinearizer_modal_metadata_save%']}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A single label/value row inside the read-only metadata description list.
 *
 * @param props - Component props.
 * @param props.label - Localized field label shown as `<dt>`.
 * @param props.value - Value string shown as `<dd>`.
 * @param props.mono - When true, renders the value in a monospace font.
 * @returns A `<dt>`/`<dd>` pair.
 */
function MetadataRow({
  label,
  value,
  mono,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-0.5">
      <dt className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide">
        {label}
      </dt>
      <dd
        className={['tw-text-sm tw-break-all tw-text-foreground', mono ? 'tw-font-mono' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
