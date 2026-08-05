import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { useCallback, useEffect, useState } from 'react';
import useProjectsForSource from '../../hooks/useProjectsForSource';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { ModalShell } from './ModalShell';
import { ProjectSummaryDetails } from './ProjectSummaryDetails';

/** Localized string keys requested for this modal's rendered text. */
const SAVE_AS_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_saveAs_title%',
  '%interlinearizer_modal_saveAs_new_section%',
  '%interlinearizer_modal_create_name_label%',
  '%interlinearizer_modal_create_name_placeholder%',
  '%interlinearizer_modal_create_description_label%',
  '%interlinearizer_modal_create_description_placeholder%',
  '%interlinearizer_modal_saveAs_save_new%',
  '%interlinearizer_modal_saveAs_existing_section%',
  '%interlinearizer_modal_saveAs_none%',
  '%interlinearizer_modal_saveAs_overwrite%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_body%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_ok%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_cancel%',
  '%interlinearizer_modal_saveAs_cancel%',
  '%interlinearizer_modal_select_name_unnamed%',
  '%interlinearizer_modal_select_active_badge%',
  '%interlinearizer_modal_select_modified_prefix%',
];

/**
 * Save As dialog. Lets the user save the current draft either to a brand-new project (name +
 * description) or by overwriting an existing project for this source (with an inline confirm). This
 * component is presentational: it collects the choice and delegates the actual persistence to the
 * caller via {@link onSaveNew} / {@link onOverwrite}.
 *
 * @param props.sourceProjectId - Source project whose existing interlinear projects to list as
 *   overwrite targets.
 * @param props.activeProjectId - ID of the project currently open as the active Save target, if
 *   any; the matching overwrite target is badged so the user can tell which project the draft is
 *   currently working against.
 * @param props.defaultName - Name prefilled into the new-project field (the draft's suggested
 *   name).
 * @param props.defaultDescription - Description prefilled into the new-project field.
 * @param props.onSaveNew - Called with the trimmed name/description to save the draft as a new
 *   project.
 * @param props.onOverwrite - Called with the chosen existing project to overwrite it with the
 *   draft.
 * @param props.onClose - Called when the user dismisses the dialog without saving.
 * @returns The Save As overlay, or nothing while localized strings are loading.
 */
export function SaveAsProjectModal({
  sourceProjectId,
  activeProjectId,
  defaultName,
  defaultDescription,
  onSaveNew,
  onOverwrite,
  onClose,
}: Readonly<{
  sourceProjectId: string;
  activeProjectId?: string;
  defaultName?: string;
  defaultDescription?: string;
  onSaveNew: (name?: string, description?: string) => void | Promise<void>;
  onOverwrite: (project: InterlinearProjectSummary) => void | Promise<void>;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(SAVE_AS_MODAL_STRING_KEYS);

  const [name, setName] = useState(defaultName ?? '');
  const [description, setDescription] = useState(defaultDescription ?? '');
  const { projects, isLoading } = useProjectsForSource(sourceProjectId);

  // Guards the save controls against double-submit; `isSubmitting` disables them while a save runs.
  const { isSubmitting, runGuarded } = useSubmitGuard();

  /** The existing project pending an overwrite confirmation, or `undefined`. */
  const [confirmOverwrite, setConfirmOverwrite] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  useEffect(() => {
    // A confirmation is armed against a project in the list it was chosen from, so every new list —
    // including the empty one a load starts from — retires it.
    setConfirmOverwrite(undefined);
  }, [projects]);

  /**
   * Saves the draft as a new project with the trimmed name/description (blank fields → undefined),
   * blocking re-entry while the save is in flight so a double-click cannot create duplicate
   * projects.
   */
  const handleSaveNew = useCallback(
    () =>
      runGuarded(async () => {
        await onSaveNew(name.trim() || undefined, description.trim() || undefined);
      }),
    [name, description, onSaveNew, runGuarded],
  );

  /**
   * Overwrites the chosen existing project with the draft, blocking re-entry while the save is in
   * flight so a double-click cannot fire the overwrite (or another save) twice.
   */
  const handleConfirmOverwrite = useCallback(
    (project: InterlinearProjectSummary) =>
      runGuarded(async () => {
        await onOverwrite(project);
      }),
    [onOverwrite, runGuarded],
  );

  /**
   * A dismissal — Escape or a click outside — backs out one layer at a time: an armed overwrite
   * confirmation collapses first, so an attempt aimed at that box does not also discard the name
   * and description typed above it. A second dismissal then closes the modal.
   */
  const handleDismiss = useCallback(() => {
    if (confirmOverwrite) setConfirmOverwrite(undefined);
    else onClose();
  }, [confirmOverwrite, onClose]);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="save-as-modal-title"
      title={localizedStrings['%interlinearizer_modal_saveAs_title%']}
      width="tw:w-lg"
      // Only an in-flight save suppresses dismissal. The overwrite-list load is a read-only fetch
      // with nothing to abandon, so it leaves the modal dismissable while it runs.
      onClose={isSubmitting ? undefined : handleDismiss}
    >
      <h3 className="tw:text-sm tw:font-medium tw:mb-2">
        {localizedStrings['%interlinearizer_modal_saveAs_new_section%']}
      </h3>
      <Label className="tw:mb-1" htmlFor="save-as-name">
        {localizedStrings['%interlinearizer_modal_create_name_label%']}
      </Label>
      <Input
        id="save-as-name"
        className="tw:mb-3 tw:w-full"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={localizedStrings['%interlinearizer_modal_create_name_placeholder%']}
      />
      <Label className="tw:mb-1" htmlFor="save-as-description">
        {localizedStrings['%interlinearizer_modal_create_description_label%']}
      </Label>
      <Textarea
        id="save-as-description"
        className="tw:mb-3 tw:resize-none"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={localizedStrings['%interlinearizer_modal_create_description_placeholder%']}
      />
      <div className="tw:flex tw:justify-end tw:mb-4">
        <Button onClick={handleSaveNew} data-testid="save-as-new" disabled={isSubmitting}>
          {localizedStrings['%interlinearizer_modal_saveAs_save_new%']}
        </Button>
      </div>

      <h3 className="tw:text-sm tw:font-medium tw:mb-2">
        {localizedStrings['%interlinearizer_modal_saveAs_existing_section%']}
      </h3>
      {projects.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground tw:mb-4">
          {localizedStrings['%interlinearizer_modal_saveAs_none%']}
        </p>
      ) : (
        <ul className="tw:flex tw:flex-col tw:gap-1 tw:mb-4 tw:max-h-72 tw:overflow-y-auto">
          {projects.map((project) => {
            const projectName =
              project.name ?? localizedStrings['%interlinearizer_modal_select_name_unnamed%'];
            // Show the confirm inline under the row whose Overwrite was pressed, and highlight that
            // row, so it is unambiguous which project the confirm will replace.
            const isConfirming = confirmOverwrite?.id === project.id;
            return (
              <li key={project.id} className="tw:flex tw:flex-col tw:gap-2">
                <div className="tw:flex tw:items-center tw:gap-2">
                  <span
                    className={`tw:flex-1 tw:flex tw:rounded tw:border tw:px-3 tw:py-2 tw:text-sm tw:min-w-0 ${
                      isConfirming
                        ? 'tw:border-destructive tw:bg-destructive/10'
                        : 'tw:border-border tw:bg-muted/40'
                    }`}
                  >
                    <ProjectSummaryDetails
                      activeBadgeLabel={
                        localizedStrings['%interlinearizer_modal_select_active_badge%']
                      }
                      className="tw:flex-1"
                      isActive={project.id === activeProjectId}
                      modifiedPrefix={
                        localizedStrings['%interlinearizer_modal_select_modified_prefix%']
                      }
                      project={project}
                      unnamedLabel={localizedStrings['%interlinearizer_modal_select_name_unnamed%']}
                    />
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmOverwrite(project)}
                    disabled={isSubmitting || isConfirming}
                  >
                    {localizedStrings['%interlinearizer_modal_saveAs_overwrite%']}
                  </Button>
                </div>
                {isConfirming && (
                  <div className="tw:modal-error-box tw:p-3">
                    <p className="tw:text-sm tw:mb-2">
                      <span className="tw:font-medium tw:block tw:mb-1">{projectName}</span>
                      {localizedStrings['%interlinearizer_modal_saveAs_overwrite_confirm_body%']}
                    </p>
                    <div className="tw:modal-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmOverwrite(undefined)}
                      >
                        {
                          localizedStrings[
                            '%interlinearizer_modal_saveAs_overwrite_confirm_cancel%'
                          ]
                        }
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        data-testid="save-as-overwrite-confirm"
                        onClick={() => handleConfirmOverwrite(project)}
                        disabled={isSubmitting}
                      >
                        {localizedStrings['%interlinearizer_modal_saveAs_overwrite_confirm_ok%']}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={isLoading || isSubmitting}>
          {localizedStrings['%interlinearizer_modal_saveAs_cancel%']}
        </Button>
      </div>
    </ModalShell>
  );
}
