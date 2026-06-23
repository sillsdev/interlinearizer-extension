import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { isInterlinearProjectSummary } from '../../types/type-guards';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import { ModalShell } from './ModalShell';

/** Localized string keys used by {@link SaveAsProjectModal}. */
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
];

/**
 * Save As dialog. Lets the user save the current draft either to a brand-new project (name +
 * description) or by overwriting an existing project for this source (with an inline confirm). This
 * component is presentational: it collects the choice and delegates the actual persistence to the
 * caller via {@link onSaveNew} / {@link onOverwrite}.
 *
 * @param props - Component props
 * @param props.sourceProjectId - Source project whose existing interlinear projects to list as
 *   overwrite targets.
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
  defaultName,
  defaultDescription,
  onSaveNew,
  onOverwrite,
  onClose,
}: Readonly<{
  sourceProjectId: string;
  defaultName?: string;
  defaultDescription?: string;
  onSaveNew: (name?: string, description?: string) => void | Promise<void>;
  onOverwrite: (project: InterlinearProjectSummary) => void | Promise<void>;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(SAVE_AS_MODAL_STRING_KEYS);

  const [name, setName] = useState(defaultName ?? '');
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [projects, setProjects] = useState<InterlinearProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Guards the save controls against double-submit; `isSubmitting` disables them while a save runs.
  const { isSubmitting, runGuarded } = useSubmitGuard();

  /** The existing project pending an overwrite confirmation, or `undefined`. */
  const [confirmOverwrite, setConfirmOverwrite] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  /** Incremented each time a load starts; lets an in-flight response detect it has been superseded. */
  const loadGenRef = useRef(0);

  /**
   * Loads existing interlinear projects for `sourceProjectId` to populate the overwrite list. Logs
   * and notifies on failure; ignores a response superseded by a newer load.
   *
   * @returns A promise that resolves when the list is loaded or the failure has been handled.
   */
  const loadProjects = useCallback(async () => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    setIsLoading(true);
    setProjects([]);
    setConfirmOverwrite(undefined);
    try {
      const json = await papi.commands.sendCommand(
        'interlinearizer.getProjectsForSource',
        sourceProjectId,
      );
      if (gen !== loadGenRef.current) return;
      const parsed: unknown = JSON.parse(json);
      /* v8 ignore next 2 -- backend always returns a JSON array; defensive guard */
      if (!Array.isArray(parsed))
        throw new TypeError('getProjectsForSource did not return an array');
      setProjects(parsed.filter(isInterlinearProjectSummary));
    } catch (e) {
      // Ignore a failure from a load that a newer one has superseded (mirrors the success-path stale
      // guard above) so a stale rejection cannot fire a spurious error notification.
      if (gen !== loadGenRef.current) return;
      logger.error('Interlinearizer: failed to load projects for Save As', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
        .catch(() => {});
    } finally {
      if (gen === loadGenRef.current) setIsLoading(false);
    }
  }, [sourceProjectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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
   *
   * @param project - The existing project to overwrite.
   */
  const handleConfirmOverwrite = useCallback(
    (project: InterlinearProjectSummary) =>
      runGuarded(async () => {
        await onOverwrite(project);
      }),
    [onOverwrite, runGuarded],
  );

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleId="save-as-modal-title"
      title={localizedStrings['%interlinearizer_modal_saveAs_title%']}
      width="tw:w-lg"
      rounded="tw:rounded-lg"
    >
      <h3 className="tw:text-sm tw:font-medium tw:mb-2">
        {localizedStrings['%interlinearizer_modal_saveAs_new_section%']}
      </h3>
      <label className="tw:modal-form-label" htmlFor="save-as-name">
        {localizedStrings['%interlinearizer_modal_create_name_label%']}
      </label>
      <input
        id="save-as-name"
        className="tw:modal-form-input tw:mb-3"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={localizedStrings['%interlinearizer_modal_create_name_placeholder%']}
      />
      <label className="tw:modal-form-label" htmlFor="save-as-description">
        {localizedStrings['%interlinearizer_modal_create_description_label%']}
      </label>
      <textarea
        id="save-as-description"
        className="tw:modal-form-input tw:mb-3 tw:resize-none"
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
          {projects.map((project) => (
            <li key={project.id} className="tw:flex tw:items-center tw:gap-2">
              <span className="tw:flex-1 tw:flex tw:items-center tw:gap-2 tw:rounded tw:border tw:border-border tw:bg-muted/40 tw:px-3 tw:py-2 tw:text-sm tw:min-w-0">
                <span className="tw:font-medium tw:truncate">
                  {project.name ?? localizedStrings['%interlinearizer_modal_select_name_unnamed%']}
                </span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmOverwrite(project)}
                disabled={isSubmitting}
              >
                {localizedStrings['%interlinearizer_modal_saveAs_overwrite%']}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirmOverwrite && (
        <div className="tw:modal-error-box tw:p-3 tw:mb-4">
          <p className="tw:text-sm tw:mb-2">
            {localizedStrings['%interlinearizer_modal_saveAs_overwrite_confirm_body%']}
          </p>
          <div className="tw:modal-actions">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOverwrite(undefined)}>
              {localizedStrings['%interlinearizer_modal_saveAs_overwrite_confirm_cancel%']}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="save-as-overwrite-confirm"
              onClick={() => handleConfirmOverwrite(confirmOverwrite)}
              disabled={isSubmitting}
            >
              {localizedStrings['%interlinearizer_modal_saveAs_overwrite_confirm_ok%']}
            </Button>
          </div>
        </div>
      )}

      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={isLoading || isSubmitting}>
          {localizedStrings['%interlinearizer_modal_saveAs_cancel%']}
        </Button>
      </div>
    </ModalShell>
  );
}
