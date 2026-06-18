import type { UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { useCallback, useState } from 'react';
import type { OpenableProject } from '../../hooks/useDraftProject';
import { emptyAnalysis } from '../../types/empty-factories';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { isInterlinearProjectSummary, isTextAnalysis } from '../../types/type-guards';
import { CreateProjectModal, type CreateDraftConfig } from './CreateProjectModal';
import { DiscardDraftConfirm } from './DiscardDraftConfirm';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import { SaveAsProjectModal } from './SaveAsProjectModal';
import { SelectInterlinearProjectModal } from './SelectInterlinearProjectModal';

/** Which project-related modal is currently open; `'none'` means no modal is visible. */
export type ModalState = 'none' | 'select' | 'create' | 'metadata' | 'saveAs';

/**
 * A draft-replacing action deferred behind the unsaved-changes confirmation: either starting a new
 * empty draft or opening an existing project into the draft.
 */
type PendingReplace =
  | { kind: 'new'; config: NewDraftConfig }
  | { kind: 'open'; project: InterlinearProjectSummary };

/**
 * Single mount point for all project-related dialogs. Renders the active one of
 * {@link SelectInterlinearProjectModal}, {@link CreateProjectModal}, {@link ProjectMetadataModal}, or
 * {@link SaveAsProjectModal}, with the {@link DiscardDraftConfirm} guard overlaid on top when a
 * draft-replacing action is pending (so canceling returns to the underlying modal with its state
 * intact); manages the shared WebView state for the active project; and routes New / Open / Save As
 * through the draft (rather than persisting projects directly on every edit).
 *
 * @param props - Component props
 * @param props.activeProject - The currently active interlinear project (the Save target), read
 *   from WebView state by the parent.
 * @param props.defaultAnalysisLanguage - BCP 47 tag forwarded to {@link CreateProjectModal} as the
 *   initial value of the analysis language field; should be the platform UI language.
 * @param props.dirty - Whether the draft has unsaved changes; when true, New / Open are gated
 *   behind the discard confirmation.
 * @param props.getDraftSnapshot - Returns the latest draft envelope (analysis + config) to persist
 *   on Save As.
 * @param props.loadFromProject - Loads a project's analysis + config into the draft (the "Open"
 *   flow).
 * @param props.markSynced - Marks the draft as saved (clears `dirty`) after a successful Save As,
 *   given the analysis that was persisted; a no-op if an edit landed during the save.
 * @param props.modal - Which modal is currently open.
 * @param props.projectId - PAPI source project ID passed from the host.
 * @param props.resetDraft - Resets the draft to an empty baseline with the given config (the "New"
 *   flow).
 * @param props.setModal - Setter for which modal is open.
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores).
 * @returns The currently active modal/confirmation, or an empty container when none is open.
 */
export default function ProjectModals({
  activeProject,
  defaultAnalysisLanguage,
  dirty,
  getDraftSnapshot,
  loadFromProject,
  markSynced,
  modal,
  projectId,
  setModal,
  useWebViewState,
}: Readonly<{
  activeProject: InterlinearProjectSummary | undefined;
  defaultAnalysisLanguage?: string;
  dirty: boolean;
  getDraftSnapshot: () => DraftProject | undefined;
  loadFromProject: (project: OpenableProject) => void;
  markSynced: (savedAnalysis: TextAnalysis) => void;
  modal: ModalState;
  projectId: string;
  setModal: (modal: ModalState) => void;
  useWebViewState: UseWebViewStateHook;
}>) {
  const [, setActiveProject, resetActiveProject] = useWebViewState<
    InterlinearProjectSummary | undefined
  >('activeProject', undefined);

  /**
   * The project currently open in the metadata modal. Set when the user clicks the info icon in the
   * select modal or triggers "View Project Info" from the menu.
   */
  const [metadataProject, setMetadataProject] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  /**
   * Tracks whether the create modal was opened from the select modal ("Create new" button) or from
   * a top-menu command. `true` means opened via the select modal, so closing without creating
   * restores the select modal; `false` means opened from the menu, so closing dismisses to
   * `'none'`.
   */
  const [createSourceIsSelect, setCreateSourceIsSelect] = useState(false);

  /**
   * Tracks whether the metadata modal was opened from the select modal (info icon) or from the
   * top-menu "View Project Info" item. `true` means opened via the select modal, so closing the
   * metadata modal restores the select modal; `false` means opened from the menu, so closing
   * dismisses to `'none'`.
   */
  const [metadataSourceIsSelect, setMetadataSourceIsSelect] = useState(false);

  /** A draft-replacing action awaiting confirmation because the draft has unsaved changes. */
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | undefined>(undefined);

  const resolvedMetadataProject = metadataProject ?? activeProject;

  /**
   * Opens the metadata modal for the project whose info icon was clicked in the select modal.
   *
   * @param project - The project to display in the metadata modal.
   */
  const handleViewInfo = useCallback(
    (project: InterlinearProjectSummary) => {
      setMetadataProject(project);
      setMetadataSourceIsSelect(true);
      setModal('metadata');
    },
    [setModal],
  );

  /**
   * Called when the metadata modal saves changes. Updates `activeProject` state when the edited
   * project is the currently active one.
   *
   * @param updated - The updated name, description, and analysisLanguages.
   */
  const handleMetadataProjectSaved = useCallback(
    (updated: { name?: string; description?: string; analysisLanguages: string[] }) => {
      if (activeProject && resolvedMetadataProject?.id === activeProject.id) {
        setActiveProject({ ...activeProject, ...updated });
      }
    },
    [activeProject, resolvedMetadataProject, setActiveProject],
  );

  /**
   * Called when the metadata modal deletes the project. Clears `activeProject` if it was the
   * deleted project.
   *
   * @param deletedId - UUID of the project that was deleted.
   */
  const handleMetadataProjectDeleted = useCallback(
    (deletedId: string) => {
      if (activeProject?.id === deletedId) resetActiveProject();
    },
    [activeProject, resetActiveProject],
  );

  /**
   * Loads the given project into the draft as a working copy and makes it the Save target. Fetches
   * the full project (with analysis) via `interlinearizer.getProject`, validates it, then seeds the
   * draft and dismisses the modal. Logs and notifies on failure, leaving the draft untouched.
   *
   * @param project - The project summary the user chose to open.
   * @returns A promise that resolves once the draft is loaded or the failure has been handled.
   */
  const openProject = useCallback(
    async (project: InterlinearProjectSummary) => {
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getProject', project.id);
        const parsed: unknown = json ? JSON.parse(json) : undefined;
        const analysis =
          parsed && typeof parsed === 'object' && 'analysis' in parsed
            ? parsed.analysis
            : undefined;
        if (!isInterlinearProjectSummary(parsed) || !isTextAnalysis(analysis)) {
          await papi.notifications
            .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
            .catch(() => {});
          return;
        }
        loadFromProject({
          analysisLanguages: parsed.analysisLanguages,
          ...(parsed.targetProjectId !== undefined && { targetProjectId: parsed.targetProjectId }),
          analysis,
        });
        setActiveProject(project);
        setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to open project into draft', e);
        await papi.notifications
          .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
          .catch(() => {});
      }
    },
    [loadFromProject, setActiveProject, setModal],
  );

  /**
   * Creates a new interlinear project with the given config, loads it into the draft as the active
   * working copy, and dismisses the modal. Logs and notifies on failure, leaving the draft untouched.
   *
   * @param config - The configuration collected by the New dialog.
   * @returns A promise that resolves once the project is created and loaded, or the failure is
   *   handled.
   */
  const startNewDraft = useCallback(
    async (config: CreateDraftConfig) => {
      try {
        const createdJson = await papi.commands.sendCommand(
          'interlinearizer.createProject',
          projectId,
          config.analysisLanguages,
          undefined,
          config.name,
          config.description,
        );
        const created: unknown = JSON.parse(createdJson);
        if (!isInterlinearProjectSummary(created)) {
          await papi.notifications
            .send({
              message: '%interlinearizer_error_create_project_failed%',
              severity: 'error',
            })
            .catch(() => {});
          return;
        }
        loadFromProject({
          analysisLanguages: created.analysisLanguages,
          ...(created.targetProjectId !== undefined && {
            targetProjectId: created.targetProjectId,
          }),
          analysis: emptyAnalysis(),
        });
        setActiveProject(created);
      } catch (e) {
        logger.error('Interlinearizer: failed to create interlinear project', e);
        return;
      }
      setCreateSourceIsSelect(false);
      setModal('none');
    },
    [projectId, loadFromProject, setActiveProject, setModal],
  );

  /**
   * Called when the user selects a project in the select modal. Opens it immediately, or defers
   * behind the unsaved-changes confirmation when the draft is dirty.
   *
   * @param project - The project the user selected.
   */
  const handleSelectProject = useCallback(
    (project: InterlinearProjectSummary) => {
      if (dirty) setPendingReplace({ kind: 'open', project });
      else openProject(project);
    },
    [dirty, openProject],
  );

  /**
   * Called when the New dialog is submitted. Starts the new draft immediately, or defers behind the
   * unsaved-changes confirmation when the draft is dirty.
   *
   * @param config - The configuration collected by the New dialog.
   */
  const handleCreateDraft = useCallback(
    (config: CreateDraftConfig) => {
      if (dirty) setPendingReplace({ kind: 'new', config });
      else startNewDraft(config);
    },
    [dirty, startNewDraft],
  );

  /** Confirms the deferred draft-replacing action after the user accepts losing unsaved changes. */
  const handleConfirmReplace = useCallback(async () => {
    /* v8 ignore next -- the confirm only renders while a pending action exists */
    if (!pendingReplace) return;
    if (pendingReplace.kind === 'open') await openProject(pendingReplace.project);
    else await startNewDraft(pendingReplace.config);
    setPendingReplace(undefined);
  }, [pendingReplace, openProject, startNewDraft]);

  /** Cancels the deferred action, returning to the underlying modal with the draft untouched. */
  const handleCancelReplace = useCallback(() => setPendingReplace(undefined), []);

  /**
   * Saves the current draft as a brand-new project: creates the project with the draft's languages
   * / target, writes the draft's analysis into it, then makes it the active Save target and clears
   * the dirty flag. Backend commands surface their own error notifications; here we only log.
   *
   * @param name - Trimmed project name, or `undefined`.
   * @param description - Trimmed project description, or `undefined`.
   * @returns A promise that resolves once the save completes or the failure has been handled.
   */
  const handleSaveAsNew = useCallback(
    async (name?: string, description?: string) => {
      const snapshot = getDraftSnapshot();
      /* v8 ignore next -- the Save As modal is only open once the draft has loaded */
      if (!snapshot) return;
      try {
        const createdJson = await papi.commands.sendCommand(
          'interlinearizer.createProject',
          projectId,
          snapshot.analysisLanguages,
          snapshot.targetProjectId,
          name,
          description,
        );
        const created: unknown = JSON.parse(createdJson);
        if (!isInterlinearProjectSummary(created)) {
          await papi.notifications
            .send({ message: '%interlinearizer_error_create_project_failed%', severity: 'error' })
            .catch(() => {});
          return;
        }
        await papi.commands.sendCommand(
          'interlinearizer.saveAnalysis',
          created.id,
          JSON.stringify(snapshot.analysis),
        );
        setActiveProject(created);
        markSynced(snapshot.analysis);
        setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to save draft as new project', e);
      }
    },
    [getDraftSnapshot, projectId, setActiveProject, markSynced, setModal],
  );

  /**
   * Overwrites an existing project with the current draft: writes the draft's analysis into the
   * chosen project, reconciles the project's declared config (analysis languages / alignment
   * target) with the draft so the metadata matches the glosses now stored in it, makes it the
   * active Save target, and clears the dirty flag. The backend surfaces its own error notification;
   * here we only log.
   *
   * @param project - The existing project to overwrite.
   * @returns A promise that resolves once the overwrite completes or the failure has been handled.
   */
  const handleOverwrite = useCallback(
    async (project: InterlinearProjectSummary) => {
      const snapshot = getDraftSnapshot();
      /* v8 ignore next -- the Save As modal is only open once the draft has loaded */
      if (!snapshot) return;
      try {
        await papi.commands.sendCommand(
          'interlinearizer.saveAnalysis',
          project.id,
          JSON.stringify(snapshot.analysis),
        );
        // Push the draft's analysis languages / alignment target onto the project so its declared
        // metadata stays consistent with the glosses just written (mirroring how Save As → New
        // carries the draft's config into the created project). The project's name and description
        // are intentionally preserved — overwriting keeps the target's identity.
        await papi.commands.sendCommand(
          'interlinearizer.updateProjectMetadata',
          project.id,
          project.name,
          project.description,
          snapshot.analysisLanguages,
          snapshot.targetProjectId,
        );
        setActiveProject({
          ...project,
          analysisLanguages: snapshot.analysisLanguages,
          // Assign explicitly (rather than a conditional spread) so a target binding on the
          // overwritten project is cleared when the draft has none, matching what was persisted.
          targetProjectId: snapshot.targetProjectId,
        });
        markSynced(snapshot.analysis);
        setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to overwrite project with draft', e);
      }
    },
    [getDraftSnapshot, setActiveProject, markSynced, setModal],
  );

  /** Called when the user dismisses the Save As modal without saving. */
  const handleSaveAsClose = useCallback(() => setModal('none'), [setModal]);

  /**
   * Called when the user clicks "Create new" in the select modal. Switches to the create modal and
   * records that the create modal was opened from the select modal.
   */
  const handleSelectCreateNew = useCallback(() => {
    setCreateSourceIsSelect(true);
    setModal('create');
  }, [setModal]);

  /** Called when the user dismisses the select modal without choosing a project. */
  const handleSelectClose = useCallback(() => setModal('none'), [setModal]);

  /**
   * Called when the user dismisses the create modal without submitting. Returns to the select modal
   * when it was opened from there; otherwise dismisses to `'none'`.
   */
  const handleCreateClose = useCallback(() => {
    setModal(createSourceIsSelect ? 'select' : 'none');
    setCreateSourceIsSelect(false);
  }, [createSourceIsSelect, setModal]);

  /**
   * Called when the metadata modal is dismissed. Returns to the select modal when it was opened
   * from there; otherwise dismisses to `'none'`.
   */
  const handleMetadataClose = useCallback(() => {
    setModal(metadataSourceIsSelect ? 'select' : 'none');
    setMetadataSourceIsSelect(false);
    setMetadataProject(undefined);
  }, [metadataSourceIsSelect, setModal]);

  const draftSnapshot = getDraftSnapshot();

  return (
    <div>
      {modal === 'select' && (
        <SelectInterlinearProjectModal
          sourceProjectId={projectId}
          activeProjectId={activeProject?.id}
          onSelect={handleSelectProject}
          onCreateNew={handleSelectCreateNew}
          onClose={handleSelectClose}
          onViewInfo={handleViewInfo}
        />
      )}

      {modal === 'create' && (
        <CreateProjectModal
          defaultAnalysisLanguage={defaultAnalysisLanguage}
          onClose={handleCreateClose}
          onCreateDraft={handleCreateDraft}
        />
      )}

      {modal === 'saveAs' && (
        <SaveAsProjectModal
          sourceProjectId={projectId}
          defaultName={draftSnapshot?.suggestedName}
          defaultDescription={draftSnapshot?.suggestedDescription}
          onSaveNew={handleSaveAsNew}
          onOverwrite={handleOverwrite}
          onClose={handleSaveAsClose}
        />
      )}

      {modal === 'metadata' && resolvedMetadataProject && (
        <ProjectMetadataModal
          interlinearProjectId={resolvedMetadataProject.id}
          name={resolvedMetadataProject.name}
          description={resolvedMetadataProject.description}
          sourceProjectId={resolvedMetadataProject.sourceProjectId}
          targetProjectId={resolvedMetadataProject.targetProjectId}
          analysisLanguages={resolvedMetadataProject.analysisLanguages}
          createdAt={resolvedMetadataProject.createdAt}
          onClose={handleMetadataClose}
          onProjectSaved={handleMetadataProjectSaved}
          onProjectDeleted={handleMetadataProjectDeleted}
        />
      )}

      {/* The discard guard overlays the active modal rather than replacing it, so canceling
          returns to that modal with its in-progress input intact, and confirming an Open does not
          unmount (and re-fetch) the still-open select modal underneath. */}
      {pendingReplace && (
        <DiscardDraftConfirm onConfirm={handleConfirmReplace} onCancel={handleCancelReplace} />
      )}
    </div>
  );
}
