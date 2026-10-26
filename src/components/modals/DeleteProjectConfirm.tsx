import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useCallback } from 'react';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const DELETE_PROJECT_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_deleteProject_title%',
  '%interlinearizer_confirm_deleteProject_title_unnamed%',
  '%interlinearizer_confirm_deleteProject_body%',
  '%interlinearizer_confirm_deleteProject_pt9Unaffected%',
  '%interlinearizer_confirm_deleteProject_ok%',
  '%interlinearizer_confirm_deleteProject_cancel%',
];

/**
 * Confirmation dialog that deletes an interlinear project once the user accepts. A failed delete
 * leaves the dialog open so the user can retry or back out; the backend reports the failure
 * itself.
 *
 * @param props.projectId - UUID of the project to delete.
 * @param props.projectName - The project's name, shown in the title; absent for an unnamed project.
 * @param props.onCancel - Called when the user backs out, leaving the project in place.
 * @param props.onDeleted - Called with the project's UUID once the delete has landed.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function DeleteProjectConfirm({
  projectId,
  projectName,
  onCancel,
  onDeleted,
}: Readonly<{
  projectId: string;
  projectName?: string;
  onCancel: () => void;
  onDeleted: (deletedProjectId: string) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    DELETE_PROJECT_CONFIRM_STRING_KEYS,
  );
  const { isSubmitting, runGuarded } = useSubmitGuard();

  const handleConfirm = useCallback(
    () =>
      runGuarded(async () => {
        try {
          await papi.commands.sendCommand('interlinearizer.deleteProject', projectId);
          onDeleted(projectId);
        } catch (e) {
          logger.error('Interlinearizer: failed to delete project', e);
        }
      }),
    [projectId, onDeleted, runGuarded],
  );

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const title = projectName
    ? formatReplacementString(localizedStrings['%interlinearizer_confirm_deleteProject_title%'], {
        name: projectName,
      })
    : localizedStrings['%interlinearizer_confirm_deleteProject_title_unnamed%'];

  return (
    <ModalShell
      titleTestId="delete-project-modal-title"
      title={title}
      width="tw:w-md"
      onClose={isSubmitting ? undefined : onCancel}
    >
      <p className="tw:text-sm tw:mb-4">
        {localizedStrings['%interlinearizer_confirm_deleteProject_body%']}
        <br />
        {localizedStrings['%interlinearizer_confirm_deleteProject_pt9Unaffected%']}
      </p>
      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          {localizedStrings['%interlinearizer_confirm_deleteProject_cancel%']}
        </Button>
        <Button
          variant="destructive"
          onClick={handleConfirm}
          data-testid="delete-project-confirm"
          disabled={isSubmitting}
        >
          {localizedStrings['%interlinearizer_confirm_deleteProject_ok%']}
        </Button>
      </div>
    </ModalShell>
  );
}
