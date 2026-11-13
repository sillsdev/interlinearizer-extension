import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback, useMemo, useState } from 'react';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import type { GlossCountsByTag } from '../../utils/gloss-counts';
import { parseLanguageTags } from '../../utils/language-tags';
import { ModalShell } from './ModalShell';
import { RemoveLanguagesConfirm } from './RemoveLanguagesConfirm';

/** Localized string keys requested for this modal's rendered text. */
const PROJECT_METADATA_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_metadata_title%',
  '%interlinearizer_modal_metadata_name_label%',
  '%interlinearizer_modal_metadata_name_placeholder%',
  '%interlinearizer_modal_metadata_description_label%',
  '%interlinearizer_modal_metadata_description_placeholder%',
  '%interlinearizer_modal_metadata_analysis_language_label%',
  '%interlinearizer_modal_metadata_language_placeholder%',
  '%interlinearizer_modal_metadata_created_label%',
  '%interlinearizer_modal_metadata_modified_label%',
  '%interlinearizer_modal_metadata_save%',
  '%interlinearizer_modal_metadata_close%',
  '%interlinearizer_modal_metadata_lastSynced_label%',
];

/** Props for {@link ProjectMetadataModal}. */
type ProjectMetadataModalProps = Readonly<{
  /** UUID of the active interlinearizer project. */
  interlinearProjectId: string;
  /** Optional user-facing name of the project. */
  name?: string;
  /** Optional user-facing description of the project. */
  description?: string;
  /** Short name of the source project, which the title ends with. */
  sourceShortName: string;
  /** Optional Platform.Bible project ID of the target text for bilateral alignment projects. */
  targetProjectId?: string;
  /** BCP 47 tags for the analysis languages, as shown and edited. */
  analysisLanguages: string[];
  /**
   * The analysis languages Save keeps in the stored project, when the edited ones go elsewhere. The
   * open project's languages belong to its draft, which writes them to the project when it is
   * saved. Absent when Save writes the edited languages to the project.
   */
  storedAnalysisLanguages?: string[];
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent modification. */
  updatedAt: string;
  /**
   * When the project is a Paratext 9 import, the ISO 8601 timestamp of the import that produced its
   * current content. Its presence switches the modal to the read-only variant: every field renders
   * as static text and there is no Save.
   */
  pt9ImportedAt?: string;
  /** Whether the fields and Save are disabled for a reason outside the form. */
  isSaveBlocked?: boolean;
  /**
   * Counts the project's glosses in each of the given languages. When it is given, Save asks before
   * removing a secondary analysis language that has glosses.
   */
  countGlosses?: (tags: string[]) => Promise<GlossCountsByTag>;
  /** Callback invoked when the modal should be dismissed without saving. */
  onClose: () => void;
  /** Optional callback invoked with updated metadata after a successful save. */
  onProjectSaved?: (updated: {
    name?: string;
    description?: string;
    analysisLanguages: string[];
    updatedAt?: string;
  }) => void;
}>;

/**
 * Modal that displays and allows editing of the active interlinearizer project's metadata. Editable
 * fields are name, description, and analysis language. Read-only fields are the creation and
 * modification dates and, for an import, the last sync.
 */
export function ProjectMetadataModal({
  interlinearProjectId,
  name,
  description,
  sourceShortName,
  targetProjectId,
  analysisLanguages,
  storedAnalysisLanguages,
  createdAt,
  updatedAt,
  pt9ImportedAt,
  isSaveBlocked = false,
  countGlosses,
  onClose,
  onProjectSaved,
}: ProjectMetadataModalProps) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    PROJECT_METADATA_MODAL_STRING_KEYS,
  );

  const [editName, setEditName] = useState(name ?? '');
  const [editDescription, setEditDescription] = useState(description ?? '');
  const [editLanguages, setEditLanguages] = useState(analysisLanguages.join(', '));
  // Guards Save against double-submit; `isSubmitting` disables the controls while it runs.
  const { isSubmitting, runGuarded } = useSubmitGuard();
  /** The removed languages that have glosses, while Save waits for the user to confirm. */
  const [removedGlossCounts, setRemovedGlossCounts] = useState<
    [language: string, count: number][] | undefined
  >(undefined);

  const readOnly = pt9ImportedAt !== undefined;

  const formattedDate = useMemo(() => new Date(createdAt).toLocaleString(), [createdAt]);
  const formattedModifiedDate = useMemo(() => new Date(updatedAt).toLocaleString(), [updatedAt]);
  const formattedLastSynced = useMemo(
    () => (pt9ImportedAt === undefined ? undefined : new Date(pt9ImportedAt).toLocaleString()),
    [pt9ImportedAt],
  );

  /**
   * Parsed analysis-language tags from the comma-separated field. Parsed once per edit, so every
   * decision that depends on the tags sees the same list.
   */
  const parsedLanguages = useMemo(() => parseLanguageTags(editLanguages), [editLanguages]);

  /**
   * Sends the updated name and description to the backend, with the analysis languages the stored
   * project keeps, then hands the edited fields to the caller and closes the modal. Logs on
   * failure; the backend command handler is responsible for showing the error notification so this
   * handler does not re-send it.
   *
   * The analysis-languages input is interpreted as a comma-separated list of BCP 47 tags; entries
   * are trimmed and empty entries dropped. Save is disabled when the name is blank or the parsed
   * list is empty, since neither may be cleared.
   */
  const saveMetadata = useCallback(async () => {
    const newName = editName.trim();
    const newDescription = editDescription.trim() || undefined;
    try {
      const updatedProjectJson = await papi.commands.sendCommand(
        'interlinearizer.updateProjectMetadata',
        interlinearProjectId,
        newName,
        newDescription,
        storedAnalysisLanguages ?? parsedLanguages,
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
  }, [
    editName,
    editDescription,
    parsedLanguages,
    storedAnalysisLanguages,
    interlinearProjectId,
    targetProjectId,
    onProjectSaved,
    onClose,
  ]);

  /**
   * Saves, unless the edit removes secondary analysis languages that have glosses. In that case it
   * shows how many glosses each has and waits for the user to confirm. A failed count is logged and
   * does not hold up the save, because removing a language deletes none of its glosses.
   */
  const handleSave = useCallback(
    () =>
      runGuarded(async () => {
        const removed = analysisLanguages
          .slice(1)
          .filter((language) => !parsedLanguages.includes(language));
        if (countGlosses && removed.length > 0) {
          let counts: GlossCountsByTag = {};
          try {
            counts = await countGlosses(removed);
          } catch (e) {
            logger.warn('Interlinearizer: failed to count the glosses of removed languages', e);
          }
          const withGlosses = removed
            .map((language): [string, number] => [language, counts[language] ?? 0])
            .filter(([, count]) => count > 0);
          if (withGlosses.length > 0) {
            setRemovedGlossCounts(withGlosses);
            return;
          }
        }
        await saveMetadata();
      }),
    [analysisLanguages, countGlosses, parsedLanguages, runGuarded, saveMetadata],
  );

  const handleConfirmRemove = useCallback(() => {
    setRemovedGlossCounts(undefined);
    runGuarded(saveMetadata);
  }, [runGuarded, saveMetadata]);

  const handleCancelRemove = useCallback(() => setRemovedGlossCounts(undefined), []);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="project-metadata-modal-title"
      title={formatReplacementString(localizedStrings['%interlinearizer_modal_metadata_title%'], {
        projectName: sourceShortName,
      })}
      width="tw:w-lg"
      onClose={isSubmitting ? undefined : onClose}
    >
      {/* Editable fields; static rows for a read-only import, whose values the import stamps. */}
      {readOnly ? (
        <dl className="tw:flex tw:flex-col tw:gap-2 tw:mb-4" data-testid="metadata-readonly-fields">
          <MetadataRow
            label={localizedStrings['%interlinearizer_modal_metadata_name_label%']}
            value={name ?? ''}
          />
          <MetadataRow
            label={localizedStrings['%interlinearizer_modal_metadata_description_label%']}
            value={description ?? ''}
          />
          <MetadataRow
            label={localizedStrings['%interlinearizer_modal_metadata_analysis_language_label%']}
            value={analysisLanguages.join(', ')}
            mono
          />
        </dl>
      ) : (
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
              disabled={isSaveBlocked}
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
              disabled={isSaveBlocked}
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
              placeholder={
                localizedStrings['%interlinearizer_modal_metadata_language_placeholder%']
              }
              onChange={(e) => setEditLanguages(e.target.value)}
              disabled={isSaveBlocked}
            />
          </div>
        </div>
      )}

      {/* Read-only metadata */}
      <dl className="tw:flex tw:flex-col tw:gap-2 tw:mb-5">
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_created_label%']}
          value={formattedDate}
        />
        <MetadataRow
          label={localizedStrings['%interlinearizer_modal_metadata_modified_label%']}
          value={formattedModifiedDate}
        />
        {formattedLastSynced !== undefined && (
          <MetadataRow
            label={localizedStrings['%interlinearizer_modal_metadata_lastSynced_label%']}
            value={formattedLastSynced}
          />
        )}
      </dl>

      <div className="tw:flex tw:gap-2 tw:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {localizedStrings['%interlinearizer_modal_metadata_close%']}
        </Button>
        {!readOnly && (
          <Button
            onClick={handleSave}
            disabled={
              isSaveBlocked ||
              isSubmitting ||
              editName.trim() === '' ||
              parsedLanguages.length === 0
            }
          >
            {localizedStrings['%interlinearizer_modal_metadata_save%']}
          </Button>
        )}
      </div>

      {removedGlossCounts && (
        <RemoveLanguagesConfirm
          glossCounts={removedGlossCounts}
          onConfirm={handleConfirmRemove}
          onCancel={handleCancelRemove}
        />
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
        className={['tw:text-sm tw:break-words tw:text-foreground', mono ? 'tw:font-mono' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
