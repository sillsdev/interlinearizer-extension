/** @file Unit tests for ProjectModals. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeWebViewState } from '../test-helpers';
import type { ModalState } from '../../components/ProjectModals';
import ProjectModals from '../../components/ProjectModals';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';

/** Minimal project summary used in tests. */
const MOCK_PROJECT: InterlinearProjectSummary = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  sourceProjectId: 'source-proj',
  analysisLanguages: ['en'],
  name: 'My Project',
};

const MOCK_PROJECT_2: InterlinearProjectSummary = {
  id: 'proj-2',
  createdAt: '2026-02-01T00:00:00Z',
  sourceProjectId: 'source-proj',
  analysisLanguages: ['fr'],
  name: 'French Project',
};

jest.mock('../../components/SelectInterlinearProjectModal', () => ({
  __esModule: true,
  SelectInterlinearProjectModal: ({
    onSelect,
    onCreateNew,
    onClose,
    onViewInfo,
  }: {
    onSelect: (p: InterlinearProjectSummary) => void;
    onCreateNew: () => void;
    onClose: () => void;
    onViewInfo: (p: InterlinearProjectSummary) => void;
  }) => (
    <div data-testid="select-modal">
      <button type="button" data-testid="select-select" onClick={() => onSelect(MOCK_PROJECT)}>
        Select
      </button>
      <button type="button" data-testid="select-select-2" onClick={() => onSelect(MOCK_PROJECT_2)}>
        Select 2
      </button>
      <button type="button" data-testid="select-create-new" onClick={onCreateNew}>
        Create new
      </button>
      <button type="button" data-testid="select-close" onClick={onClose}>
        Close
      </button>
      <button type="button" data-testid="select-view-info" onClick={() => onViewInfo(MOCK_PROJECT)}>
        View info
      </button>
      <button
        type="button"
        data-testid="select-view-info-2"
        onClick={() => onViewInfo(MOCK_PROJECT_2)}
      >
        View info 2
      </button>
    </div>
  ),
}));

jest.mock('../../components/CreateProjectModal', () => ({
  __esModule: true,
  CreateProjectModal: ({
    onClose,
    onProjectCreated,
  }: {
    onClose: () => void;
    onProjectCreated: (p: InterlinearProjectSummary) => void;
  }) => (
    <div data-testid="create-modal">
      <button type="button" data-testid="create-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="create-created"
        onClick={() => {
          onProjectCreated(MOCK_PROJECT);
          onClose();
        }}
      >
        Created
      </button>
    </div>
  ),
}));

jest.mock('../../components/ProjectMetadataModal', () => ({
  __esModule: true,
  ProjectMetadataModal: ({
    onClose,
    onProjectSaved,
    onProjectDeleted,
  }: {
    onClose: () => void;
    onProjectSaved?: (u: {
      name?: string;
      description?: string;
      analysisLanguages: string[];
    }) => void;
    onProjectDeleted?: (id: string) => void;
  }) => (
    <div data-testid="metadata-modal">
      <button type="button" data-testid="metadata-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="metadata-save"
        onClick={() => {
          onProjectSaved?.({ name: 'Updated', analysisLanguages: ['fr'] });
          onClose();
        }}
      >
        Save
      </button>
      <button
        type="button"
        data-testid="metadata-delete"
        onClick={() => {
          onProjectDeleted?.(MOCK_PROJECT.id);
          onClose();
        }}
      >
        Delete
      </button>
      <button
        type="button"
        data-testid="metadata-delete-2"
        onClick={() => {
          onProjectDeleted?.(MOCK_PROJECT_2.id);
          onClose();
        }}
      >
        Delete 2
      </button>
    </div>
  ),
}));

/**
 * Renders ProjectModals with sensible defaults and returns helpers for assertions.
 *
 * @param overrides - Partial props to merge over the defaults. Supports `activeProject`, `modal`
 *   (defaults to `'none'`), `setModal` (defaults to a fresh `jest.fn()`), and `useWebViewState`
 *   (defaults to a fresh {@link makeWebViewState} instance).
 * @returns An object containing `setModal` — either the caller-supplied function or the internally
 *   created `jest.fn()` — so callers can assert on it after interactions.
 */
function renderModals(
  overrides: Partial<{
    activeProject: InterlinearProjectSummary | undefined;
    modal: ModalState;
    setModal: (m: ModalState) => void;
    useWebViewState: ReturnType<typeof makeWebViewState>;
  }> = {},
) {
  const setModal = overrides.setModal ?? jest.fn();
  const useWebViewState = overrides.useWebViewState ?? makeWebViewState();
  render(
    <ProjectModals
      activeProject={overrides.activeProject}
      modal={overrides.modal ?? 'none'}
      projectId="source-proj"
      setModal={setModal}
      useWebViewState={useWebViewState}
    />,
  );
  return { setModal };
}

describe('ProjectModals', () => {
  describe('modal visibility', () => {
    it('renders nothing when modal is none', () => {
      const { container } = render(
        <ProjectModals
          activeProject={undefined}
          modal="none"
          projectId="source-proj"
          setModal={jest.fn()}
          useWebViewState={makeWebViewState()}
        />,
      );
      expect(container.querySelector('[data-testid]')).toBeNull();
    });

    it('renders the select modal when modal is select', () => {
      renderModals({ modal: 'select' });
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('renders the create modal when modal is create', () => {
      renderModals({ modal: 'create' });
      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('renders the metadata modal when modal is metadata and activeProject is set', () => {
      renderModals({ modal: 'metadata', activeProject: MOCK_PROJECT });
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('renders nothing when modal is metadata but no active or metadata project', () => {
      const { container } = render(
        <ProjectModals
          activeProject={undefined}
          modal="metadata"
          projectId="source-proj"
          setModal={jest.fn()}
          useWebViewState={makeWebViewState()}
        />,
      );
      expect(container.querySelector('[data-testid="metadata-modal"]')).toBeNull();
    });
  });

  describe('select modal', () => {
    it('calls setModal with none when select modal close is clicked', async () => {
      const { setModal } = renderModals({ modal: 'select' });
      await userEvent.click(screen.getByTestId('select-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('sets the active project and calls setModal with none when a project is selected', async () => {
      const state = makeWebViewState();
      const { setModal } = renderModals({ modal: 'select', useWebViewState: state });
      await userEvent.click(screen.getByTestId('select-select'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('calls setModal with create when create new is clicked', async () => {
      const { setModal } = renderModals({ modal: 'select' });
      await userEvent.click(screen.getByTestId('select-create-new'));
      expect(setModal).toHaveBeenCalledWith('create');
    });

    it('opens metadata modal for the chosen project when view info is clicked', async () => {
      const { setModal } = renderModals({ modal: 'select' });
      await userEvent.click(screen.getByTestId('select-view-info'));
      expect(setModal).toHaveBeenCalledWith('metadata');
    });
  });

  describe('create modal', () => {
    it('calls setModal with none when create modal is closed without a select source', async () => {
      const { setModal } = renderModals({ modal: 'create' });
      await userEvent.click(screen.getByTestId('create-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('calls setModal with select on close when opened from the select modal', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-create-new'));
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="create"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('create-close'));
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('resets createSourceIsSelect after closing from select source', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-create-new'));
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="create"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('create-close'));
      // After close, setModal returns to 'select'. If we re-render with create again,
      // closing this time should go to 'none' (select source was reset).
      setModal.mockClear();
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="create"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('create-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('sets the active project and calls setModal with none when a project is created', async () => {
      const state = makeWebViewState();
      const { setModal } = renderModals({ modal: 'create', useWebViewState: state });
      await userEvent.click(screen.getByTestId('create-created'));
      expect(setModal).toHaveBeenCalledWith('none');
    });
  });

  describe('metadata modal', () => {
    it('calls setModal with none when metadata modal closes without a select source', async () => {
      const { setModal } = renderModals({ modal: 'metadata', activeProject: MOCK_PROJECT });
      await userEvent.click(screen.getByTestId('metadata-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('calls setModal with select on close when metadataSourceIsSelect is true', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-close'));
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('resets metadataSourceIsSelect after closing from select source', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-close'));
      // After close, setModal returns to 'select'. If we re-render with metadata again,
      // closing this time should go to 'none' (select source was reset).
      setModal.mockClear();
      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('updates activeProject when the saved project matches the active project', async () => {
      const state = makeWebViewState();
      // Set active project first via select modal
      const setModal = jest.fn();
      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-select'));

      // Re-render with metadata open and activeProject as MOCK_PROJECT
      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-save'));
      // Saving should call setModal with none and update the active project (no error)
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('does not update activeProject when the saved project does not match the active project', async () => {
      const state = makeWebViewState();
      const setModal = jest.fn();

      // Open select, choose project 1 as active, then view info for project 2
      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-select'));
      await userEvent.click(screen.getByTestId('select-view-info-2'));

      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      // Saving project 2 — onProjectSaved is called but activeProject (proj-1) ≠ metadataProject (proj-2)
      await userEvent.click(screen.getByTestId('metadata-save'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('does not update activeProject when there is no active project on save', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-save'));
      // Metadata was opened from select, so close returns to select (not none)
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('resets the active project when the deleted project matches the active project', async () => {
      const state = makeWebViewState();
      const setModal = jest.fn();

      // Set MOCK_PROJECT as active via select, then open metadata
      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-select'));

      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-delete'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('does not reset the active project when the deleted project does not match', async () => {
      const state = makeWebViewState();
      const setModal = jest.fn();

      const { rerender } = render(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info-2'));

      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      setModal.mockClear();
      // Delete proj-2, but active is proj-1 — should not reset active project
      await userEvent.click(screen.getByTestId('metadata-delete-2'));
      // Opened from select, so close returns to select
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('does not reset the active project when there is no active project on delete', async () => {
      const state = makeWebViewState();
      const setModal = jest.fn();

      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));

      rerender(
        <ProjectModals
          activeProject={undefined}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-delete'));
      // Opened from select, so close returns to select
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('uses metadataProject over activeProject when both are set', async () => {
      const setModal = jest.fn();
      const state = makeWebViewState();

      // Open select, view info for proj-2 (sets metadataProject=proj-2)
      const { rerender } = render(
        <ProjectModals
          activeProject={undefined}
          modal="select"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info-2'));

      rerender(
        <ProjectModals
          activeProject={MOCK_PROJECT}
          modal="metadata"
          projectId="source-proj"
          setModal={setModal}
          useWebViewState={state}
        />,
      );
      // Metadata modal is visible — it uses metadataProject (proj-2), not activeProject (proj-1)
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });
  });
});
