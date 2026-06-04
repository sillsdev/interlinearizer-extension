import type { UseWebViewStateHook } from '@papi/core';
import { useCallback, useState } from 'react';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import { SelectInterlinearProjectModal } from './SelectInterlinearProjectModal';

/** Which project-related modal is currently open; `'none'` means no modal is visible. */
export type ModalState = 'none' | 'select' | 'create' | 'metadata';

/**
 * Single mount point for all project-related dialogs. Renders at most one of
 * {@link SelectInterlinearProjectModal}, {@link CreateProjectModal}, or {@link ProjectMetadataModal}
 * based on the `modal` prop, and manages the shared WebView state for the active project.
 *
 * @param props - Component props
 * @param props.activeProject - The currently active interlinear project, read from WebView state by
 *   the parent.
 * @param props.defaultAnalysisLanguage - BCP 47 tag forwarded to {@link CreateProjectModal} as the
 *   initial value of the analysis language field; should be the platform UI language.
 * @param props.modal - Which modal is currently open
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.setModal - Setter for which modal is open
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores)
 * @returns The currently active modal, or an empty container when no modal is open.
 */
export default function ProjectModals({
  activeProject,
  defaultAnalysisLanguage,
  modal,
  projectId,
  setModal,
  useWebViewState,
}: Readonly<{
  activeProject: InterlinearProjectSummary | undefined;
  defaultAnalysisLanguage?: string;
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
   * Called when the user selects a project in the select modal. Persists it as the active project
   * and dismisses the modal.
   *
   * @param project - The project the user selected.
   */
  const handleSelectProject = useCallback(
    (project: InterlinearProjectSummary) => {
      setActiveProject(project);
      setModal('none');
    },
    [setActiveProject, setModal],
  );

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
   * Called when the user dismisses the create modal without saving. Returns to the select modal
   * when it was opened from there; otherwise dismisses to `'none'`.
   */
  const handleCreateClose = useCallback(() => {
    setModal(createSourceIsSelect ? 'select' : 'none');
    setCreateSourceIsSelect(false);
  }, [createSourceIsSelect, setModal]);

  /**
   * Called when the create modal successfully creates a project. Persists it as the active project
   * and dismisses the modal.
   *
   * @param project - The newly created project.
   */
  const handleProjectCreated = useCallback(
    (project: InterlinearProjectSummary) => {
      setActiveProject(project);
      setModal('none');
    },
    [setActiveProject, setModal],
  );

  /**
   * Called when the metadata modal is dismissed. Returns to the select modal when it was opened
   * from there; otherwise dismisses to `'none'`.
   */
  const handleMetadataClose = useCallback(() => {
    setModal(metadataSourceIsSelect ? 'select' : 'none');
    setMetadataSourceIsSelect(false);
    setMetadataProject(undefined);
  }, [metadataSourceIsSelect, setModal]);

  return (
    <div>
      {modal === 'select' && (
        <SelectInterlinearProjectModal
          sourceProjectId={projectId}
          onSelect={handleSelectProject}
          onCreateNew={handleSelectCreateNew}
          onClose={handleSelectClose}
          onViewInfo={handleViewInfo}
        />
      )}

      {modal === 'create' && (
        <CreateProjectModal
          projectId={projectId}
          defaultAnalysisLanguage={defaultAnalysisLanguage}
          onClose={handleCreateClose}
          onProjectCreated={handleProjectCreated}
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
    </div>
  );
}
