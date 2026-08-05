import type { UseWebViewStateHook } from '@papi/core';
import papi, { logger } from '@papi/frontend';
import type { DraftProject, SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { useCallback, useState } from 'react';
import type { NewDraftConfig, OpenableProject } from '../../hooks/useDraftProject';
import useSubmitGuard from '../../hooks/useSubmitGuard';
import { toProjectSummary } from '../../types/interlinear-project-summary';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import {
  isInterlinearProjectSummary,
  isSegmentationDelta,
  isTextAnalysis,
} from '../../types/type-guards';
import { CreateProjectModal, type CreateDraftConfig } from './CreateProjectModal';
import { DiscardDraftConfirm } from './DiscardDraftConfirm';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import { SaveAsProjectModal } from './SaveAsProjectModal';
import { SelectInterlinearProjectModal } from './SelectInterlinearProjectModal';

/** Which project-related modal is currently open; `'none'` means no modal is visible. */
export type ModalState = 'none' | 'select' | 'create' | 'metadata' | 'saveAs';

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
 *   is silently lost by the draft-replacing swap.
 * @param props.getDraftSnapshot - Returns the latest draft envelope (analysis + config) to persist
 *   on Save As.
 * @param props.loadFromProject - Loads a project's analysis + config into the draft (the "Open"
 *   flow).
 * @param props.newDraft - Seeds the in-memory draft with empty analysis and the given config;
 *   called before the New flow's backend round-trip so the editor is ready regardless of whether
 *   persistence succeeds.
 * @param props.markSynced - Marks the draft as saved (clears `dirty`) after a successful Save As,
 *   given the analysis and boundary delta that were persisted; a no-op if an edit landed during the
 *   save.
 * @param props.modal - Which modal is currently open.
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
  loadFromProject,
  newDraft,
  markSynced,
  modal,
  projectId,
  setModal,
  useWebViewState,
}: Readonly<{
  activeProject: InterlinearProjectSummary | undefined;
  defaultAnalysisLanguage?: string;
  hasUnsavedWork: boolean;
  getDraftSnapshot: () => DraftProject | undefined;
  loadFromProject: (project: OpenableProject) => void;
  newDraft: (config: NewDraftConfig) => void;
  markSynced: (
    savedAnalysis: TextAnalysis,
    savedSegmentation: SegmentationDelta | undefined,
  ) => void;
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
   * Guards opening a project straight from the select modal — the path taken when the draft has no
   * unsaved work, so no confirmation intervenes. `isSubmitting` suppresses that modal's dismissal
   * while the open is in flight. An open deferred behind the confirmation has its own guard.
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
        ...(config.name !== undefined && { suggestedName: config.name }),
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
      if (hasUnsavedWork) setPendingReplace({ kind: 'open', project });
      else openGuard.runGuarded(() => openProject(project));
    },
    [hasUnsavedWork, openGuard, openProject],
  );

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
   * Saves the current draft as a brand-new project: creates the project with the draft's languages
   * / target, writes the draft's analysis and segment boundaries into it, then makes it the active
   * Save target and clears the dirty flag. Backend commands surface their own error notifications;
   * here we only log.
   *
   * @param name - Trimmed project name, or `undefined`.
   * @param description - Trimmed project description, or `undefined`.
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

        const savedJson = await papi.commands.sendCommand(
          'interlinearizer.saveAnalysis',
          created.id,
          JSON.stringify(snapshot.analysis),
          // Carry the draft's boundary state into the new project; `null` (the clear sentinel) is
          // harmless on a freshly created project, which stores no boundaries yet.
          // eslint-disable-next-line no-null/no-null -- "null" is the JSON sentinel that clears boundaries
          JSON.stringify(snapshot.segmentation ?? null),
        );
        // `saveAnalysis` bumps `updatedAt` past the creation time it was born with, so prefer the
        // project it returns; fall back to the freshly created object if the payload is malformed.
        const parsedSaved: unknown = savedJson ? JSON.parse(savedJson) : undefined;
        setActiveProject(
          toProjectSummary(isInterlinearProjectSummary(parsedSaved) ? parsedSaved : created),
        );
        markSynced(snapshot.analysis, snapshot.segmentation);
        setModal('none');
      } catch (e) {
        logger.error('Interlinearizer: failed to save draft as new project', e);
      }
    },
    [getDraftSnapshot, projectId, setActiveProject, markSynced, setModal],
  );

  /**
   * Overwrites an existing project with the current draft: writes the draft's analysis and segment
   * boundaries into the chosen project, reconciles the project's declared config (analysis
   * languages / alignment target) with the draft so the metadata matches the glosses now stored in
   * it, makes it the active Save target, and clears the dirty flag. The backend surfaces its own
   * error notification; here we only log.
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
          // Send the draft's boundary state so the overwritten project's boundaries match the
          // analysis just written; `null` clears any boundaries the target had stored before.
          // eslint-disable-next-line no-null/no-null -- "null" is the JSON sentinel that clears boundaries
          JSON.stringify(snapshot.segmentation ?? null),
        );
        // Push the draft's analysis languages / alignment target onto the project so its declared
        // metadata stays consistent with the glosses just written (mirroring how Save As → New
        // carries the draft's config into the created project). The project's name and description
        // are intentionally preserved — overwriting keeps the target's identity.
        const updatedJson = await papi.commands.sendCommand(
          'interlinearizer.updateProjectMetadata',
          project.id,
          project.name,
          project.description,
          snapshot.analysisLanguages,
          snapshot.targetProjectId,
        );
        // Prefer the server-returned project (it carries the refreshed `updatedAt`) as the new
        // active project; fall back to the pre-save object with the draft's config if the payload is
        // missing or malformed so the Save still completes.
        const parsedUpdated: unknown = updatedJson ? JSON.parse(updatedJson) : undefined;
        setActiveProject(
          isInterlinearProjectSummary(parsedUpdated)
            ? toProjectSummary(parsedUpdated)
            : {
                ...project,
                analysisLanguages: snapshot.analysisLanguages,
                // Assign explicitly (rather than a conditional spread) so a target binding on the
                // overwritten project is cleared when the draft has none, matching what was persisted.
                targetProjectId: snapshot.targetProjectId,
              },
        );
        markSynced(snapshot.analysis, snapshot.segmentation);
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
          isOpening={openGuard.isSubmitting}
          onSelect={handleSelectProject}
          onCreateNew={handleSelectCreateNew}
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
