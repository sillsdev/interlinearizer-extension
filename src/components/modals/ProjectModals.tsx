import type { UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import type { DraftProject } from 'interlinearizer';
import { useCallback, useEffect, useState } from 'react';
import type { DraftCopyResult, NewDraftConfig, OpenableProject } from '../../hooks/useDraftProject';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import { toProjectSummary } from '../../types/interlinear-project-summary';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import {
  isInterlinearProjectSummary,
  isSavedAsProject,
  isSegmentationDelta,
  isTextAnalysis,
} from '../../types/type-guards';
import { CreateProjectModal, type CreateDraftConfig } from './CreateProjectModal';
import { DiscardDraftConfirm } from './DiscardDraftConfirm';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import { SaveAsProjectModal } from './SaveAsProjectModal';
import { SelectInterlinearProjectModal } from './SelectInterlinearProjectModal';

/** Which project-related modal is currently open; `'none'` means no modal is visible. */
export type ModalState = 'none' | 'select' | 'create' | 'metadata' | 'saveAs' | 'importPt9';

/**
 * A draft-replacing action deferred behind the unsaved-changes confirmation: either creating and
 * persisting a new project (then seeding the draft from it), or opening an existing project into
 * the draft.
 */
type PendingReplace =
  { kind: 'new'; config: CreateDraftConfig } | { kind: 'open'; project: InterlinearProjectSummary };

/**
 * Single mount point for all project-related dialogs. Renders the active one of
 * {@link SelectInterlinearProjectModal}, {@link CreateProjectModal}, {@link ProjectMetadataModal}, or
 * {@link SaveAsProjectModal}, with the {@link DiscardDraftConfirm} guard overlaid on top when a
 * draft-replacing action is pending (so canceling returns to the underlying modal with its state
 * intact); manages the shared WebView state for the active project; and routes project lifecycle
 * actions through the draft: New creates and persists a project immediately (so it appears in
 * Select right away) and seeds the draft from it; Open loads an existing project into the draft;
 * Save / Save As write the draft's analysis back to the active project or create a new one.
 *
 * @param props.activeProject - The currently active interlinear project (the Save target), read
 *   from WebView state by the parent.
 * @param props.defaultAnalysisLanguage - BCP 47 tag forwarded to {@link CreateProjectModal} as the
 *   initial value of the analysis language field; should be the platform UI language.
 * @param props.hasUnsavedWork - Whether the draft has unsaved work — either committed-but-unsaved
 *   changes or uncommitted text still sitting in a gloss input (matching the tab's unsaved marker).
 *   When true, New / Open are gated behind the discard confirmation so neither kind of unsaved work
 *   is silently lost by the draft-replacing swap. When false, Save As reports the active project as
 *   having nothing to save rather than offering a write that would change nothing.
 * @param props.getDraftSnapshot - Returns the latest draft envelope (analysis + config).
 * @param props.commitDraft - Runs a Save As through the draft: once the stored draft is current,
 *   runs the given copy with the draft snapshot and marks the draft synced when the copy reports it
 *   landed whole. Resolves whether the copy landed, or `false` when no save could run.
 * @param props.loadFromProject - Loads a project's analysis + config into the draft (the "Open"
 *   flow).
 * @param props.newDraft - Seeds the in-memory draft with empty analysis and the given config;
 *   called before the New flow's backend round-trip so the editor is ready regardless of whether
 *   persistence succeeds.
 * @param props.modal - Which modal is currently open.
 * @param props.onImportPt9 - Called when the user chooses "Import from Paratext 9" in the select
 *   modal; the caller owns the import run and its modal.
 * @param props.onOpenImport - Called instead of the draft-open flow when the user picks a Paratext
 *   9 import in the select modal: the import opens read-only without touching the draft, so no
 *   unsaved-work confirmation is needed. Resolves once the import is open, which may be after a
 *   sync; the select modal stays inert until then.
 * @param props.openRequest - A project the caller asks to open through the normal draft-open flow,
 *   unsaved-work confirmation included; each new `requestId` performs one open. Used to open a
 *   freshly created editable copy.
 * @param props.projectId - PAPI source project ID passed from the host.
 * @param props.setModal - Setter for which modal is open.
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores).
 * @returns The currently active modal/confirmation, or an empty container when none is open.
 */
export default function ProjectModals({
  activeProject,
  defaultAnalysisLanguage,
  hasUnsavedWork,
  getDraftSnapshot,
  commitDraft,
  loadFromProject,
  newDraft,
  modal,
  onImportPt9,
  onOpenImport,
  openRequest,
  projectId,
  setModal,
  useWebViewState,
}: Readonly<{
  activeProject: InterlinearProjectSummary | undefined;
  defaultAnalysisLanguage?: string;
  hasUnsavedWork: boolean;
  getDraftSnapshot: () => DraftProject | undefined;
  commitDraft: (copy: (snapshot: DraftProject) => Promise<DraftCopyResult>) => Promise<boolean>;
  loadFromProject: (project: OpenableProject) => void;
  newDraft: (config: NewDraftConfig) => void;
  modal: ModalState;
  onImportPt9: () => void;
  onOpenImport: (
    project: InterlinearProjectSummary & {
      pt9Import: NonNullable<InterlinearProjectSummary['pt9Import']>;
    },
  ) => Promise<void>;
  openRequest?: { project: InterlinearProjectSummary; requestId: number };
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

  /**
   * Guards the project-creation round-trip against double-submit; `isSubmitting` disables the
   * create modal's Create / Cancel buttons while the backend persists the new project.
   */
  const createGuard = useSubmitGuard();

  /**
   * Guards the discard-and-replace confirmation flow (opening an existing project or starting a new
   * draft) against double-submit; `isSubmitting` disables the DiscardDraftConfirm buttons.
   */
  const replaceGuard = useSubmitGuard();

  /**
   * Guards opening a project straight from the select modal — a Paratext 9 import, or an ordinary
   * project when the draft has no unsaved work, so no confirmation intervenes. `isSubmitting`
   * suppresses that modal's dismissal while the open is in flight. An open deferred behind the
   * confirmation has its own guard.
   */
  const openGuard = useSubmitGuard();

  const resolvedMetadataProject = metadataProject ?? activeProject;

  /** Opens the metadata modal for the project whose info icon was clicked in the select modal. */
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
   * project is the currently active one, carrying through the server-refreshed `updatedAt` so the
   * cached Modified time (shown in the picker and on modal reopen) stays current.
   *
   * @param updated - The updated name, description, analysisLanguages, and refreshed `updatedAt`.
   */
  const handleMetadataProjectSaved = useCallback(
    (updated: {
      name?: string;
      description?: string;
      analysisLanguages: string[];
      updatedAt?: string;
    }) => {
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
   * the full project (with analysis and any stored segment boundaries) via
   * `interlinearizer.getProject`, validates it, then seeds the draft and dismisses the modal. Logs
   * and notifies on failure, leaving the draft untouched.
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
        const segmentation =
          parsed && typeof parsed === 'object' && 'segmentation' in parsed
            ? parsed.segmentation
            : undefined;
        if (
          !isInterlinearProjectSummary(parsed) ||
          !isTextAnalysis(analysis) ||
          (segmentation !== undefined && !isSegmentationDelta(segmentation))
        ) {
          await papi.notifications
            .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
            .catch(() => {});
          return;
        }

        loadFromProject({
          analysisLanguages: parsed.analysisLanguages,
          ...(parsed.targetProjectId !== undefined && { targetProjectId: parsed.targetProjectId }),
          ...(segmentation !== undefined && { segmentation }),
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
   * Creates a new project in storage with the given config and an empty analysis, then seeds the
   * draft from it so Save targets the newly created project. This is the "New" flow: the project is
   * persisted immediately so it shows up in "Select Interlinear Project" right away.
   *
   * `newDraft` is called synchronously before the backend round-trip so the editor is ready
   * regardless of whether persistence succeeds. This is safe: when `hasUnsavedWork` is `false` the
   * draft is either already committed to the active project or empty (nothing to lose); when
   * `hasUnsavedWork` is `true` the {@link DiscardDraftConfirm} dialog has already obtained consent
   * to discard.
   *
   * The `interlinearizer.createProject` command sends its own error notification before rethrowing,
   * so the catch block only needs to log.
   *
   * @param config - The configuration collected by the New dialog.
   * @returns `true` if the project was created and persisted successfully; `false` otherwise.
   *   Callers are responsible for closing the modal on success and keeping it open on failure so
   *   the user can retry without re-entering their inputs.
   */
  const createAndPersistProject = useCallback(
    async (config: CreateDraftConfig): Promise<boolean> => {
      newDraft({
        analysisLanguages: config.analysisLanguages,
        suggestedName: config.name,
        ...(config.description !== undefined && { suggestedDescription: config.description }),
      });
      let created: InterlinearProjectSummary | undefined;
      try {
        const createdJson = await papi.commands.sendCommand(
          'interlinearizer.createProject',
          projectId,
          config.analysisLanguages,
          undefined,
          config.name,
          config.description,
        );
        const parsed: unknown = JSON.parse(createdJson);
        if (isInterlinearProjectSummary(parsed)) {
          created = toProjectSummary(parsed);
        } else {
          await papi.notifications
            .send({ message: '%interlinearizer_error_create_project_failed%', severity: 'error' })
            .catch(() => {});
        }
      } catch (e) {
        logger.error('Interlinearizer: failed to create project from New dialog', e);
      }
      if (created) {
        setActiveProject(created);
      } else {
        resetActiveProject();
      }
      return created !== undefined;
    },
    [newDraft, projectId, resetActiveProject, setActiveProject],
  );

  /**
   * Called when the user selects a project in the select modal. Opens it immediately, or defers
   * behind the unsaved-changes confirmation when the draft has unsaved work.
   */
  const handleSelectProject = useCallback(
    (project: InterlinearProjectSummary) => {
      // A Paratext 9 import opens read-only without touching the draft, so it needs neither the
      // unsaved-work confirmation nor the draft-open flow. Rebuilt with the provenance the check
      // just proved present, since narrowing one property does not narrow the object being passed.
      // Guarded like the draft open beside it: opening an import can take a manifest probe and a
      // whole sync, and an unguarded modal would stay live for the duration - long enough for a
      // second choice to settle first and then be overwritten by the import arriving late.
      const { pt9Import } = project;
      if (pt9Import !== undefined) {
        openGuard.runGuarded(() => onOpenImport({ ...project, pt9Import }));
        return;
      }
      if (hasUnsavedWork) setPendingReplace({ kind: 'open', project });
      else openGuard.runGuarded(() => openProject(project));
    },
    [hasUnsavedWork, onOpenImport, openGuard, openProject],
  );

  // Each new requestId opens the requested project exactly as picking it in the select modal
  // would, unsaved-work confirmation included. Keyed on the id alone so re-renders with the same
  // request do not re-open.
  useEffect(() => {
    if (openRequest) handleSelectProject(openRequest.project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one open per requestId, not per handler identity
  }, [openRequest?.requestId]);

  /**
   * Creates and persists a project from the given config (guarded against double-submit) and, on
   * success, closes the create modal. Every New flow lands here, so none can diverge on how a
   * project is created; on failure the modal stays open so the user can retry without re-entering
   * their inputs.
   *
   * @param config - The configuration collected by the New dialog.
   */
  const createDraftAndClose = useCallback(
    async (config: CreateDraftConfig) => {
      let success = false;
      await createGuard.runGuarded(async () => {
        success = await createAndPersistProject(config);
      });
      if (success) {
        setCreateSourceIsSelect(false);
        setModal('none');
      }
    },
    [createAndPersistProject, createGuard, setCreateSourceIsSelect, setModal],
  );

  /**
   * Called when the New dialog is submitted. Creates and persists the project immediately, or
   * defers behind the unsaved-changes confirmation when the draft has unsaved work.
   *
   * @param config - The configuration collected by the New dialog.
   */
  const handleCreateDraft = useCallback(
    async (config: CreateDraftConfig) => {
      if (hasUnsavedWork) {
        setPendingReplace({ kind: 'new', config });
        return;
      }
      await createDraftAndClose(config);
    },
    [createDraftAndClose, hasUnsavedWork],
  );

  /**
   * Confirms the deferred draft-replacing action after the user accepts losing unsaved changes. A
   * deferred Open then proceeds exactly as an unguarded one would, error handling and modal
   * dismissal included. A deferred New closes on success; on failure the discard confirm is
   * dismissed but the underlying create modal stays visible so the user can retry.
   */
  const handleConfirmReplace = useCallback(async () => {
    /* v8 ignore next -- the confirm only renders while a pending action exists */
    if (!pendingReplace) return;

    await replaceGuard.runGuarded(async () => {
      try {
        if (pendingReplace.kind === 'open') {
          await openProject(pendingReplace.project);
        } else {
          await createDraftAndClose(pendingReplace.config);
        }
      } finally {
        setPendingReplace(undefined);
      }
    });
  }, [createDraftAndClose, openProject, pendingReplace, replaceGuard]);

  /** Cancels the deferred action, returning to the underlying modal with the draft untouched. */
  const handleCancelReplace = useCallback(() => setPendingReplace(undefined), []);

  /**
   * Saves the current draft as a brand-new project: has the host create the project with the
   * draft's languages / target and copy the stored draft's analysis and segment boundaries into it,
   * then makes it the active Save target and closes. When the project leaves some of the draft's
   * books out, the draft stays unsaved. Backend commands surface their own error notifications;
   * here we only log.
   *
   * @param name - Trimmed project name; never blank.
   * @param description - Trimmed project description, or `undefined`.
   */
  const handleSaveAsNew = useCallback(
    async (name: string, description?: string) => {
      try {
        const saved = await commitDraft(async (snapshot) => {
          const createdJson = await papi.commands.sendCommand(
            'interlinearizer.saveDraftAsProject',
            projectId,
            snapshot.analysisLanguages,
            snapshot.targetProjectId,
            name,
            description,
          );
          const created: unknown = JSON.parse(createdJson);
          if (!isSavedAsProject(created)) {
            await papi.notifications
              .send({ message: '%interlinearizer_error_create_project_failed%', severity: 'error' })
              .catch(() => {});
            return false;
          }
          setActiveProject(toProjectSummary(created.project));
          return created.omittedBooks.length > 0 ? 'partial' : true;
        });
        if (saved) setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to save draft as new project', e);
      }
    },
    [commitDraft, projectId, setActiveProject, setModal],
  );

  /**
   * Overwrites an existing project with the current draft: has the host copy the stored draft's
   * analysis and segment boundaries into the chosen project in one write that also sets the
   * project's declared config (analysis languages / alignment target) from the draft, so the
   * metadata matches the glosses now stored in it. The project's name and description are
   * preserved: overwriting keeps the target's identity. Then makes it the active Save target and
   * closes. A project that no longer exists is reported, with the draft left dirty and the modal
   * open. The backend surfaces its own error notification; here we only log.
   */
  const handleOverwrite = useCallback(
    async (project: InterlinearProjectSummary) => {
      try {
        const saved = await commitDraft(async (snapshot) => {
          const savedJson = await papi.commands.sendCommand(
            'interlinearizer.saveDraftToProject',
            projectId,
            project.id,
            {
              analysisLanguages: snapshot.analysisLanguages,
              targetProjectId: snapshot.targetProjectId,
            },
          );
          // `undefined` means the project no longer exists, so nothing was persisted.
          if (!savedJson) {
            await papi.notifications
              .send({ message: '%interlinearizer_error_save_project_missing%', severity: 'error' })
              .catch(() => {});
            return false;
          }
          const parsedSaved: unknown = JSON.parse(savedJson);
          if (!isInterlinearProjectSummary(parsedSaved))
            throw new Error('Interlinearizer: the saved project came back in an unexpected shape');
          // The server-returned project carries the refreshed `updatedAt`.
          setActiveProject(toProjectSummary(parsedSaved));
          return true;
        });
        if (saved) setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to overwrite project with draft', e);
      }
    },
    [commitDraft, projectId, setActiveProject, setModal],
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
          isOpening={openGuard.isSubmitting}
          onSelect={handleSelectProject}
          onCreateNew={handleSelectCreateNew}
          onImportPt9={onImportPt9}
          onClose={handleSelectClose}
          onViewInfo={handleViewInfo}
        />
      )}

      {modal === 'create' && (
        <CreateProjectModal
          defaultAnalysisLanguage={defaultAnalysisLanguage}
          isSubmitting={createGuard.isSubmitting}
          onClose={handleCreateClose}
          onCreateDraft={handleCreateDraft}
        />
      )}

      {modal === 'saveAs' && (
        <SaveAsProjectModal
          sourceProjectId={projectId}
          activeProjectId={activeProject?.id}
          hasUnsavedWork={hasUnsavedWork}
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
          updatedAt={resolvedMetadataProject.updatedAt}
          pt9ImportedAt={resolvedMetadataProject.pt9Import?.importedAt}
          onClose={handleMetadataClose}
          onProjectSaved={handleMetadataProjectSaved}
          onProjectDeleted={handleMetadataProjectDeleted}
        />
      )}

      {/* The discard guard overlays the active modal rather than replacing it, so canceling
          returns to that modal with its in-progress input intact, and confirming an Open does not
          unmount (and re-fetch) the still-open select modal underneath. */}
      {pendingReplace && (
        <DiscardDraftConfirm
          isSubmitting={replaceGuard.isSubmitting}
          onCancel={handleCancelReplace}
          onConfirm={handleConfirmReplace}
        />
      )}
    </div>
  );
}
