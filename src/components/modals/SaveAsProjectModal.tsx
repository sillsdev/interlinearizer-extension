import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label, Textarea } from 'platform-bible-react';
import { useCallback, useEffect, useState } from 'react';
import useProjectsForSource from '../../hooks/useProjectsForSource';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { parseLanguageTags } from '../../utils/language-tags';
import { uniqueDefaultName } from '../../utils/unique-name';
import { ModalShell } from './ModalShell';
import { ProjectSummaryDetails } from './ProjectSummaryDetails';

/** Localized string keys requested for this modal's rendered text. */
const SAVE_AS_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_saveAs_title%',
  '%interlinearizer_modal_saveAs_new_section%',
  '%interlinearizer_modal_saveAs_defaultName%',
  '%interlinearizer_modal_saveAs_defaultNameNumbered%',
  '%interlinearizer_modal_create_name_label%',
  '%interlinearizer_modal_create_name_placeholder%',
  '%interlinearizer_modal_create_description_label%',
  '%interlinearizer_modal_create_description_placeholder%',
  '%interlinearizer_modal_create_language_label%',
  '%interlinearizer_modal_create_language_placeholder%',
  '%interlinearizer_modal_saveAs_save_new%',
  '%interlinearizer_modal_saveAs_existing_section%',
  '%interlinearizer_modal_saveAs_none%',
  '%interlinearizer_modal_saveAs_overwrite%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_body%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_ok%',
  '%interlinearizer_modal_saveAs_overwrite_confirm_cancel%',
  '%interlinearizer_modal_saveAs_save_active_clean%',
  '%interlinearizer_modal_saveAs_close%',
  '%interlinearizer_modal_select_name_unnamed%',
  '%interlinearizer_modal_select_analysis_count%',
  '%interlinearizer_modal_select_books_more%',
  '%interlinearizer_modal_select_active_badge%',
  '%interlinearizer_modal_select_modified_prefix%',
];

/**
 * Fields for saving the draft as a new project.
 *
 * The fields start from `initialName`, `initialDescription`, and `initialLanguages`. Later changes
 * to those props never overwrite what the fields hold.
 */
function SaveAsNewForm({
  initialName,
  initialDescription,
  initialLanguages,
  isLoading,
  isSubmitting,
  nameLabel,
  namePlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  languageLabel,
  languagePlaceholder,
  saveLabel,
  onSave,
}: Readonly<{
  initialName: string;
  initialDescription: string;
  /** Comma-separated BCP 47 tags. */
  initialLanguages: string;
  isLoading: boolean;
  isSubmitting: boolean;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  languageLabel: string;
  languagePlaceholder: string;
  saveLabel: string;
  onSave: (name: string, description: string, languages: string) => void;
}>) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [languages, setLanguages] = useState(initialLanguages);

  return (
    <>
      <Label className="tw:mb-1" htmlFor="save-as-name">
        {nameLabel}
      </Label>
      <Input
        id="save-as-name"
        className="tw:mb-3 tw:w-full"
        disabled={isLoading}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={namePlaceholder}
      />
      <Label className="tw:mb-1" htmlFor="save-as-description">
        {descriptionLabel}
      </Label>
      <Textarea
        id="save-as-description"
        className="tw:mb-3 tw:resize-none"
        rows={2}
        disabled={isLoading}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={descriptionPlaceholder}
      />
      <Label className="tw:mb-1" htmlFor="save-as-analysis-language">
        {languageLabel}
      </Label>
      <Input
        id="save-as-analysis-language"
        className="tw:mb-3 tw:w-full"
        disabled={isLoading}
        value={languages}
        onChange={(e) => setLanguages(e.target.value)}
        placeholder={languagePlaceholder}
      />
      <div className="tw:flex tw:justify-end tw:mb-4">
        <Button
          onClick={() => onSave(name, description, languages)}
          data-testid="save-as-new"
          disabled={isLoading || isSubmitting || name.trim() === ''}
        >
          {saveLabel}
        </Button>
      </div>
    </>
  );
}

/**
 * Save As dialog. Lets the user save the current draft either to a brand-new project (name,
 * description, and analysis languages) or by overwriting an existing project for this source (with
 * an inline confirm). This component is presentational: it collects the choice and delegates the
 * actual persistence to the caller via {@link onSaveNew} / {@link onOverwrite}.
 *
 * Writing to the project the draft is already open against is an ordinary save rather than a
 * clobber, so that row's Overwrite needs no confirmation. When the draft holds nothing unsaved,
 * that write would change nothing, so the row offers no Overwrite at all.
 *
 * @param props.sourceProjectId - Source project whose existing interlinear projects to list as
 *   overwrite targets. Paratext 9 imports are left out because they are read-only.
 * @param props.activeProjectId - ID of the project currently open as the active Save target, if
 *   any; the matching overwrite target is badged so the user can tell which project the draft is
 *   currently working against.
 * @param props.hasUnsavedWork - Whether the draft holds work not yet written to the active project;
 *   only meaningful when {@link activeProjectId} names a project in the list.
 * @param props.activeProjectName - Name of the project open as the active Save target, if any. The
 *   new-project field is prefilled with a copy of this name, numbered past any name that a loaded
 *   project of the source bears. With no active project, the field starts blank. A later change to
 *   this name leaves the field as it is.
 * @param props.defaultDescription - Description prefilled into the new-project field.
 * @param props.defaultAnalysisLanguages - BCP 47 tags prefilled into the new-project analysis
 *   language field, which starts at `und` when there are none. Glosses the draft holds under a tag
 *   the new project leaves out stay stored but are not shown.
 * @param props.onSaveNew - Called with the trimmed name, the parsed analysis languages (`['und']`
 *   when the field is left blank), and the trimmed description to save the draft as a new project.
 * @param props.onOverwrite - Called with the chosen existing project to overwrite it with the
 *   draft.
 * @param props.onClose - Called when the user dismisses the dialog without saving.
 * @returns The Save As overlay, or nothing while localized strings are loading.
 */
export function SaveAsProjectModal({
  sourceProjectId,
  activeProjectId,
  hasUnsavedWork,
  activeProjectName,
  defaultDescription,
  defaultAnalysisLanguages,
  onSaveNew,
  onOverwrite,
  onClose,
}: Readonly<{
  sourceProjectId: string;
  activeProjectId?: string;
  hasUnsavedWork: boolean;
  activeProjectName?: string;
  defaultDescription?: string;
  defaultAnalysisLanguages?: readonly string[];
  onSaveNew: (
    name: string,
    analysisLanguages: string[],
    description?: string,
  ) => void | Promise<void>;
  onOverwrite: (project: InterlinearProjectSummary) => void | Promise<void>;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(SAVE_AS_MODAL_STRING_KEYS);

  const { projects, isLoading } = useProjectsForSource(sourceProjectId);
  const initialName =
    isLoading || activeProjectName === undefined
      ? ''
      : uniqueDefaultName(
          projects.map((project) => project.name),
          localizedStrings['%interlinearizer_modal_saveAs_defaultName%'],
          localizedStrings['%interlinearizer_modal_saveAs_defaultNameNumbered%'],
          { name: activeProjectName },
        );
  const overwriteTargets = projects.filter((project) => project.pt9Import === undefined);

  // Guards the save controls against double-submit; `isSubmitting` disables them while a save runs.
  const { isSubmitting, runGuarded } = useSubmitGuard();

  /** The existing project pending an overwrite confirmation, or `undefined`. */
  const [confirmOverwrite, setConfirmOverwrite] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  useEffect(() => {
    // A confirmation is armed against a project belonging to one source, so a switch to another
    // retires it — in the same flush the list itself resets, rather than a commit later.
    setConfirmOverwrite(undefined);
  }, [sourceProjectId]);

  /**
   * Saves the draft as a new project with the trimmed name and description (a blank description →
   * undefined) and the parsed analysis languages (none → `['und']`), blocking re-entry while the
   * save is in flight so a double-click cannot create duplicate projects.
   */
  const handleSaveNew = useCallback(
    (name: string, description: string, languages: string) =>
      runGuarded(async () => {
        const analysisLanguages = parseLanguageTags(languages);
        await onSaveNew(
          name.trim(),
          analysisLanguages.length > 0 ? analysisLanguages : ['und'],
          description.trim() || undefined,
        );
      }),
    [onSaveNew, runGuarded],
  );

  /**
   * Writes the draft into the chosen existing project, blocking re-entry while the save is in
   * flight so a double-click cannot fire the write (or another save) twice.
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
      {/* Remounts the form when the list loads; only then is the prefilled name ready. */}
      <SaveAsNewForm
        key={isLoading ? 'loading' : 'ready'}
        initialName={initialName}
        initialDescription={defaultDescription ?? ''}
        initialLanguages={
          defaultAnalysisLanguages?.length ? defaultAnalysisLanguages.join(', ') : 'und'
        }
        isLoading={isLoading}
        isSubmitting={isSubmitting}
        nameLabel={localizedStrings['%interlinearizer_modal_create_name_label%']}
        namePlaceholder={localizedStrings['%interlinearizer_modal_create_name_placeholder%']}
        descriptionLabel={localizedStrings['%interlinearizer_modal_create_description_label%']}
        descriptionPlaceholder={
          localizedStrings['%interlinearizer_modal_create_description_placeholder%']
        }
        languageLabel={localizedStrings['%interlinearizer_modal_create_language_label%']}
        languagePlaceholder={
          localizedStrings['%interlinearizer_modal_create_language_placeholder%']
        }
        saveLabel={localizedStrings['%interlinearizer_modal_saveAs_save_new%']}
        onSave={handleSaveNew}
      />

      <h3 className="tw:text-sm tw:font-medium tw:mb-2">
        {localizedStrings['%interlinearizer_modal_saveAs_existing_section%']}
      </h3>
      {overwriteTargets.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground tw:mb-4">
          {localizedStrings['%interlinearizer_modal_saveAs_none%']}
        </p>
      ) : (
        <ul className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-x-2 tw:gap-y-1 tw:mb-4 tw:max-h-72 tw:overflow-y-auto">
          {overwriteTargets.map((project) => {
            const projectName =
              project.name ?? localizedStrings['%interlinearizer_modal_select_name_unnamed%'];
            // The draft is already open on the active project. Writing to it risks nothing and
            // needs no confirmation. A clean draft has nothing left to write there at all.
            const isActive = project.id === activeProjectId;
            const isNoOp = isActive && !hasUnsavedWork;
            // Show the confirm inline under the row whose Overwrite was pressed, and highlight that
            // row, so it is unambiguous which project the confirm will replace.
            const isConfirming = confirmOverwrite?.id === project.id;
            return (
              <li key={project.id} className="tw:contents">
                <span
                  className={`tw:flex tw:rounded tw:border tw:px-3 tw:py-2 tw:text-sm tw:min-w-0 ${
                    isConfirming
                      ? 'tw:border-destructive tw:bg-destructive/10'
                      : 'tw:border-border tw:bg-muted/40'
                  }`}
                >
                  <ProjectSummaryDetails
                    activeBadgeLabel={
                      localizedStrings['%interlinearizer_modal_select_active_badge%']
                    }
                    analysisCountTemplate={
                      localizedStrings['%interlinearizer_modal_select_analysis_count%']
                    }
                    booksMoreTemplate={
                      localizedStrings['%interlinearizer_modal_select_books_more%']
                    }
                    className="tw:flex-1"
                    isActive={isActive}
                    modifiedPrefix={
                      localizedStrings['%interlinearizer_modal_select_modified_prefix%']
                    }
                    project={project}
                    unnamedLabel={localizedStrings['%interlinearizer_modal_select_name_unnamed%']}
                  />
                </span>
                {isNoOp ? (
                  <span className="tw:text-sm tw:text-muted-foreground tw:text-center">
                    {localizedStrings['%interlinearizer_modal_saveAs_save_active_clean%']}
                  </span>
                ) : (
                  <Button
                    className="tw:w-full"
                    variant="secondary"
                    onClick={
                      isActive
                        ? () => handleConfirmOverwrite(project)
                        : () => setConfirmOverwrite(project)
                    }
                    disabled={isSubmitting || isConfirming}
                  >
                    {localizedStrings['%interlinearizer_modal_saveAs_overwrite%']}
                  </Button>
                )}
                {isConfirming && (
                  <div className="tw:col-span-2 tw:modal-error-box tw:p-3 tw:mt-1">
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
          {localizedStrings['%interlinearizer_modal_saveAs_close%']}
        </Button>
      </div>
    </ModalShell>
  );
}
