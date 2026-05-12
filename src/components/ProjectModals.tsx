import type { UseWebViewStateHook } from '@papi/core';
import { useCallback, useState } from 'react';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectMetadataModal } from './ProjectMetadataModal';
import {
  type ActiveProjectState,
  type InterlinearProjectSummary,
  SelectInterlinearProjectModal,
} from './SelectInterlinearProjectModal';

/** Which modal is currently visible. Only one can be open at a time. */
export type ModalState = 'none' | 'select' | 'create' | 'metadata';

/**
 * Component for managing project modals in the Interlinearizer. Handles state for project creation,
 * selection, and metadata modals.
 *
 * @param props - Component props
 * @param props.activeProject - The currently active interlinear project, read from WebView state by
 *   the parent.
 * @param props.modal - Which modal is currently open
 * @param props.projectId - PAPI project ID passed from the host
 * @param props.setModal - Setter for which modal is open
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores)
 * @returns The currently active modal, or an empty container when no modal is open.
 */
export default function ProjectModals({
  activeProject,
  modal,
  projectId,
  setModal,
  useWebViewState,
}: Readonly<{
  activeProject: ActiveProjectState | undefined;
  modal: ModalState;
  projectId: string;
  setModal: (modal: ModalState) => void;
  useWebViewState: UseWebViewStateHook;
}>) {
  const [, setActiveProject, resetActiveProject] = useWebViewState<ActiveProjectState | undefined>(
    'activeProject',
    undefined,
  );

  /**
   * The project currently open in the metadata modal. Set when the user clicks the info icon in the
   * select modal or triggers "View Project Info" from the menu.
   */
  const [metadataProject, setMetadataProject] = useState<InterlinearProjectSummary | undefined>(
    undefined,
  );

  /**
   * Tracks where the metadata modal was opened from so the correct modal is restored on close.
   * `'select'` means it was opened via the info icon in the select modal; `'menu'` means it was
   * opened via the "View Project Info" menu item.
   */
  const [metadataSourceIsSelect, setMetadataSourceIsSelect] = useState(false);

  /**
   * Tracks whether the create modal was opened from the select modal, so the correct modal is
   * restored on close.
   */
  const [createSourceIsSelect, setCreateSourceIsSelect] = useState(false);

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

  return (
    <div>
      {modal === 'select' && (
        <SelectInterlinearProjectModal
          sourceProjectId={projectId}
          onSelect={(project) => {
            setActiveProject(project);
            setModal('none');
          }}
          onCreateNew={() => {
            setCreateSourceIsSelect(true);
            setModal('create');
          }}
          onClose={() => setModal('none')}
          onViewInfo={handleViewInfo}
        />
      )}

      {modal === 'create' && (
        <CreateProjectModal
          projectId={projectId}
          onClose={() => {
            setModal(createSourceIsSelect ? 'select' : 'none');
            setCreateSourceIsSelect(false);
          }}
          onProjectCreated={setActiveProject}
        />
      )}

      {modal === 'metadata' && resolvedMetadataProject && (
        <ProjectMetadataModal
          interlinearProjectId={resolvedMetadataProject.id}
          name={resolvedMetadataProject.name}
          description={resolvedMetadataProject.description}
          sourceProjectId={resolvedMetadataProject.sourceProjectId}
          analysisLanguages={resolvedMetadataProject.analysisLanguages}
          createdAt={resolvedMetadataProject.createdAt}
          onClose={() => {
            setModal(metadataSourceIsSelect ? 'select' : 'none');
            setMetadataSourceIsSelect(false);
            setMetadataProject(undefined);
          }}
          onProjectSaved={handleMetadataProjectSaved}
          onProjectDeleted={handleMetadataProjectDeleted}
        />
      )}
    </div>
  );
}
