/** @file Unit tests for ProjectModals (draft-based New / Open / Save As / metadata routing). */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi from '@papi/frontend';
import type { DraftProject } from 'interlinearizer';
import { makeWebViewState } from '../../test-helpers';
import type { ModalState } from '../../../components/modals/ProjectModals';
import ProjectModals from '../../../components/modals/ProjectModals';
import type { InterlinearProjectSummary } from '../../../types/interlinear-project-summary';
import { emptyAnalysis } from '../../../types/empty-factories';

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

/** A full project (with analysis) returned by the mocked `interlinearizer.getProject` command. */
const MOCK_FULL_PROJECT = { ...MOCK_PROJECT, analysis: emptyAnalysis() };

/** The same project but bilateral, to exercise the target-project branch of openProject. */
const MOCK_FULL_PROJECT_WITH_TARGET = {
  ...MOCK_PROJECT,
  targetProjectId: 'target-proj',
  analysis: emptyAnalysis(),
};

/** Draft snapshot returned by the default `getDraftSnapshot`. */
const MOCK_DRAFT: DraftProject = {
  sourceProjectId: 'source-proj',
  analysisLanguages: ['en'],
  analysis: emptyAnalysis(),
  dirty: true,
  suggestedName: 'Suggested Name',
  suggestedDescription: 'Suggested Desc',
};

jest.mock('../../../components/modals/SelectInterlinearProjectModal', () => ({
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

jest.mock('../../../components/modals/CreateProjectModal', () => ({
  __esModule: true,
  CreateProjectModal: ({
    defaultAnalysisLanguage,
    isSubmitting,
    onClose,
    onCreateDraft,
  }: {
    defaultAnalysisLanguage?: string;
    isSubmitting?: boolean;
    onClose: () => void;
    onCreateDraft: (config: {
      analysisLanguages: string[];
      name?: string;
      description?: string;
    }) => void;
  }) => (
    <div data-testid="create-modal" data-default-lang={defaultAnalysisLanguage}>
      <button data-testid="create-close" disabled={isSubmitting} onClick={onClose} type="button">
        Close
      </button>
      <button
        type="button"
        data-testid="create-submit"
        disabled={isSubmitting}
        onClick={() =>
          onCreateDraft({ analysisLanguages: ['en'], name: 'New', description: 'Desc' })
        }
      >
        Create draft
      </button>
    </div>
  ),
}));

jest.mock('../../../components/modals/SaveAsProjectModal', () => ({
  __esModule: true,
  SaveAsProjectModal: ({
    defaultName,
    onSaveNew,
    onOverwrite,
    onClose,
  }: {
    defaultName?: string;
    onSaveNew: (name?: string, description?: string) => void;
    onOverwrite: (p: InterlinearProjectSummary) => void;
    onClose: () => void;
  }) => (
    <div data-testid="saveas-modal" data-default-name={defaultName}>
      <button
        type="button"
        data-testid="saveas-new"
        onClick={() => onSaveNew('NewName', 'NewDesc')}
      >
        Save new
      </button>
      <button
        type="button"
        data-testid="saveas-overwrite"
        onClick={() => onOverwrite(MOCK_PROJECT)}
      >
        Overwrite
      </button>
      <button type="button" data-testid="saveas-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

jest.mock('../../../components/modals/DiscardDraftConfirm', () => ({
  __esModule: true,
  DiscardDraftConfirm: ({
    isSubmitting,
    onCancel,
    onConfirm,
  }: {
    isSubmitting?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <div data-testid="discard-modal">
      <button
        data-testid="discard-confirm"
        disabled={isSubmitting}
        onClick={onConfirm}
        type="button"
      >
        Discard
      </button>
      <button data-testid="discard-cancel" disabled={isSubmitting} onClick={onCancel} type="button">
        Cancel
      </button>
    </div>
  ),
}));

jest.mock('../../../components/modals/ProjectMetadataModal', () => ({
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

/** Props accepted by {@link buildProps}, mirroring ProjectModals' own props. */
type ModalsOverrides = Partial<{
  activeProject: InterlinearProjectSummary | undefined;
  defaultAnalysisLanguage: string;
  dirty: boolean;
  getDraftSnapshot: () => DraftProject | undefined;
  loadFromProject: jest.Mock;
  newDraft: jest.Mock;
  markSynced: jest.Mock;
  modal: ModalState;
  setModal: jest.Mock;
  useWebViewState: ReturnType<typeof makeWebViewState>;
}>;

/**
 * Builds a complete ProjectModals prop set, filling required props with sensible defaults so each
 * test only specifies what it cares about.
 *
 * @param overrides - Props to override.
 * @returns The full prop object to spread onto ProjectModals.
 */
function buildProps(overrides: ModalsOverrides = {}) {
  return {
    activeProject: overrides.activeProject,
    defaultAnalysisLanguage: overrides.defaultAnalysisLanguage,
    dirty: overrides.dirty ?? false,
    getDraftSnapshot: overrides.getDraftSnapshot ?? (() => MOCK_DRAFT),
    loadFromProject: overrides.loadFromProject ?? jest.fn(),
    newDraft: overrides.newDraft ?? jest.fn(),
    markSynced: overrides.markSynced ?? jest.fn(),
    modal: overrides.modal ?? 'none',
    projectId: 'source-proj',
    setModal: overrides.setModal ?? jest.fn(),
    useWebViewState: overrides.useWebViewState ?? makeWebViewState(),
  };
}

/**
 * Builds a `useWebViewState` stub with optional spies on the setter and/or reset for the
 * `'activeProject'` key, so a test can assert how the active project was updated or cleared. Any
 * unspecified spy — and every key other than `'activeProject'` — gets a no-op. Mirrors
 * {@link makeWebViewState}'s `[value, setter, reset]` shape without type assertions.
 *
 * @param spies - The spies to install for the `'activeProject'` slot.
 * @param spies.set - Spy invoked when the `'activeProject'` slot's setter is called.
 * @param spies.reset - Spy invoked when the `'activeProject'` slot is reset.
 * @returns A `useWebViewState`-shaped hook stub.
 */
function makeWebViewStateWithActiveProjectSpies({
  set = () => {},
  reset = () => {},
}: Readonly<{ set?: (v: unknown) => void; reset?: () => void }> = {}) {
  return <T,>(key: string, defaultValue: T): [T, (v: T) => void, () => void] => [
    defaultValue,
    key === 'activeProject' ? set : () => {},
    key === 'activeProject' ? reset : () => {},
  ];
}

describe('ProjectModals', () => {
  beforeEach(() => {
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
  });

  describe('modal visibility', () => {
    it('renders nothing when modal is none', () => {
      const { container } = render(<ProjectModals {...buildProps({ modal: 'none' })} />);
      expect(container.querySelector('[data-testid]')).toBeNull();
    });

    it('renders the select modal when modal is select', () => {
      render(<ProjectModals {...buildProps({ modal: 'select' })} />);
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('renders the create modal when modal is create', () => {
      render(<ProjectModals {...buildProps({ modal: 'create' })} />);
      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('renders the save-as modal (prefilled from the draft) when modal is saveAs', () => {
      render(<ProjectModals {...buildProps({ modal: 'saveAs' })} />);
      const modal = screen.getByTestId('saveas-modal');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('data-default-name', 'Suggested Name');
    });

    it('renders the metadata modal when modal is metadata and activeProject is set', () => {
      render(<ProjectModals {...buildProps({ modal: 'metadata', activeProject: MOCK_PROJECT })} />);
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('renders nothing when modal is metadata but no active or metadata project', () => {
      const { container } = render(
        <ProjectModals {...buildProps({ modal: 'metadata', activeProject: undefined })} />,
      );
      expect(container.querySelector('[data-testid="metadata-modal"]')).toBeNull();
    });

    it('forwards defaultAnalysisLanguage to the create modal', () => {
      render(<ProjectModals {...buildProps({ modal: 'create', defaultAnalysisLanguage: 'es' })} />);
      expect(screen.getByTestId('create-modal')).toHaveAttribute('data-default-lang', 'es');
    });
  });

  describe('open (select) flow', () => {
    it('loads the chosen project into the draft and closes when not dirty', async () => {
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify(MOCK_FULL_PROJECT));
      const loadFromProject = jest.fn();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject, setModal })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.getProject',
          'proj-1',
        ),
      );
      expect(loadFromProject).toHaveBeenCalledWith({
        analysisLanguages: ['en'],
        analysis: emptyAnalysis(),
      });
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('carries the target project id into the draft for a bilateral project', async () => {
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify(MOCK_FULL_PROJECT_WITH_TARGET));
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() =>
        expect(loadFromProject).toHaveBeenCalledWith({
          analysisLanguages: ['en'],
          targetProjectId: 'target-proj',
          analysis: emptyAnalysis(),
        }),
      );
    });

    it('notifies and does not load when getProject returns a non-project shape', async () => {
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify({ not: 'a project' }));
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('notifies and does not load when getProject returns a project without valid analysis', async () => {
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify({ ...MOCK_PROJECT, analysis: { bad: true } }));
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('notifies when getProject returns nothing (project missing)', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(undefined);
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('logs and notifies when getProject rejects', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('network'));
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('calls setModal with none when the select modal is closed', async () => {
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', setModal })} />);
      await userEvent.click(screen.getByTestId('select-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('calls setModal with create when create new is clicked', async () => {
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', setModal })} />);
      await userEvent.click(screen.getByTestId('select-create-new'));
      expect(setModal).toHaveBeenCalledWith('create');
    });

    it('opens the metadata modal for the chosen project when view info is clicked', async () => {
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', setModal })} />);
      await userEvent.click(screen.getByTestId('select-view-info'));
      expect(setModal).toHaveBeenCalledWith('metadata');
    });
  });

  describe('new (create) flow', () => {
    it('seeds the draft, calls createProject on the backend, and closes', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      const newDraft = jest.fn();
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'create',
            newDraft,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({
              set: setActiveProject,
              reset: resetActiveProject,
            }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('create-submit'));

      await waitFor(() => expect(setActiveProject).toHaveBeenCalledWith(MOCK_PROJECT));
      expect(newDraft).toHaveBeenCalledWith({
        analysisLanguages: ['en'],
        suggestedName: 'New',
        suggestedDescription: 'Desc',
      });
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        'source-proj',
        ['en'],
        undefined,
        'New',
        'Desc',
      );
      expect(resetActiveProject).not.toHaveBeenCalled();
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('falls back to resetActiveProject and keeps modal open when backend project creation fails', async () => {
      // Default mock returns undefined; JSON.parse(undefined) throws into the catch block.
      const newDraft = jest.fn();
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'create',
            newDraft,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('create-submit'));

      await waitFor(() => expect(resetActiveProject).toHaveBeenCalledTimes(1));
      expect(newDraft).toHaveBeenCalledWith({
        analysisLanguages: ['en'],
        suggestedName: 'New',
        suggestedDescription: 'Desc',
      });
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        'source-proj',
        ['en'],
        undefined,
        'New',
        'Desc',
      );
      expect(setModal).not.toHaveBeenCalledWith('none');
    });

    it('notifies and falls back to resetActiveProject and keeps modal open when backend returns a non-project shape', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify({ bad: true }));
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'create',
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('create-submit'));

      await waitFor(() => expect(resetActiveProject).toHaveBeenCalledTimes(1));
      expect(papi.notifications.send).toHaveBeenCalledWith({
        message: '%interlinearizer_error_create_project_failed%',
        severity: 'error',
      });
      expect(setModal).not.toHaveBeenCalledWith('none');
    });

    it('calls setModal with none when the create modal closes without a select source', async () => {
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'create', setModal })} />);
      await userEvent.click(screen.getByTestId('create-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('returns to the select modal when the create modal was opened from it', async () => {
      const setModal = jest.fn();
      const useWebViewState = makeWebViewState();
      const { rerender } = render(
        <ProjectModals {...buildProps({ modal: 'select', setModal, useWebViewState })} />,
      );
      await userEvent.click(screen.getByTestId('select-create-new'));
      rerender(<ProjectModals {...buildProps({ modal: 'create', setModal, useWebViewState })} />);
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('create-close'));
      expect(setModal).toHaveBeenCalledWith('select');
    });
  });

  describe('discard confirmation (dirty draft)', () => {
    it('confirms before opening a project when the draft is dirty', async () => {
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify(MOCK_FULL_PROJECT));
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', dirty: true, loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));
      // The discard confirm overlays the still-mounted select modal (so confirming Open does not
      // unmount and re-fetch it); the project is not opened yet.
      expect(screen.getByTestId('discard-modal')).toBeInTheDocument();
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
      expect(loadFromProject).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('discard-confirm'));
      await waitFor(() => expect(loadFromProject).toHaveBeenCalled());
    });

    it('cancels the discard confirm and returns to the select modal', async () => {
      const loadFromProject = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', dirty: true, loadFromProject })} />);

      await userEvent.click(screen.getByTestId('select-select'));
      await userEvent.click(screen.getByTestId('discard-cancel'));

      expect(screen.queryByTestId('discard-modal')).toBeNull();
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('confirms before creating a project when the draft is dirty', async () => {
      const newDraft = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'create', dirty: true, newDraft })} />);

      await userEvent.click(screen.getByTestId('create-submit'));
      expect(screen.getByTestId('discard-modal')).toBeInTheDocument();
      // Neither draft nor project creation should start until the user confirms discarding.
      expect(newDraft).not.toHaveBeenCalled();
      expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.createProject',
        expect.anything(),
        expect.anything(),
        undefined,
        expect.anything(),
        expect.anything(),
      );

      await userEvent.click(screen.getByTestId('discard-confirm'));
      await waitFor(() =>
        expect(newDraft).toHaveBeenCalledWith({
          analysisLanguages: ['en'],
          suggestedName: 'New',
          suggestedDescription: 'Desc',
        }),
      );
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.createProject',
        'source-proj',
        ['en'],
        undefined,
        'New',
        'Desc',
      );
    });

    it('creates the project and closes after confirming the discard on a dirty draft', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'create',
            dirty: true,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('create-submit'));
      expect(screen.getByTestId('discard-modal')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('discard-confirm'));
      await waitFor(() => expect(setModal).toHaveBeenCalledWith('none'));
      expect(setActiveProject).toHaveBeenCalledWith(MOCK_PROJECT);
    });

    it('disables the discard-confirm button while an open is in flight', async () => {
      let resolveGet!: (value: string) => void;
      jest.mocked(papi.commands.sendCommand).mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveGet = resolve;
        }),
      );
      render(<ProjectModals {...buildProps({ modal: 'select', dirty: true })} />);

      await userEvent.click(screen.getByTestId('select-select'));
      expect(screen.getByTestId('discard-confirm')).toBeEnabled();

      await userEvent.click(screen.getByTestId('discard-confirm'));
      expect(screen.getByTestId('discard-confirm')).toBeDisabled();

      resolveGet(JSON.stringify(MOCK_FULL_PROJECT));
      await waitFor(() => expect(screen.queryByTestId('discard-modal')).toBeNull());
    });
  });

  describe('save as flow', () => {
    it('creates a new project, writes the analysis, marks synced, and closes', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      const markSynced = jest.fn();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', markSynced, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.createProject',
          'source-proj',
          ['en'],
          undefined,
          'NewName',
          'NewDesc',
        ),
      );
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveAnalysis',
        'proj-1',
        JSON.stringify(emptyAnalysis()),
      );
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('notifies and does not mark synced when create returns a non-project shape', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify({ bad: true }));
      const markSynced = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', markSynced })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(markSynced).not.toHaveBeenCalled();
    });

    it('does not crash when saving a new project rejects', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('boom'));
      const markSynced = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', markSynced })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(papi.commands.sendCommand).toHaveBeenCalled());
      expect(markSynced).not.toHaveBeenCalled();
    });

    it('overwrites an existing project, marks synced, and closes', async () => {
      const markSynced = jest.fn();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', markSynced, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.saveAnalysis',
          'proj-1',
          JSON.stringify(emptyAnalysis()),
        ),
      );
      expect(markSynced).toHaveBeenCalledTimes(1);
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('reconciles the overwritten project metadata with the draft config', async () => {
      const draftWithConfig: DraftProject = {
        sourceProjectId: 'source-proj',
        analysisLanguages: ['sw', 'fr'],
        targetProjectId: 'tgt-9',
        analysis: emptyAnalysis(),
        dirty: true,
      };
      render(
        <ProjectModals
          {...buildProps({ modal: 'saveAs', getDraftSnapshot: () => draftWithConfig })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      // The project keeps its own name ('My Project') / description (undefined) but adopts the
      // draft's analysis languages and alignment target so its metadata matches the stored glosses.
      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.updateProjectMetadata',
          'proj-1',
          'My Project',
          undefined,
          ['sw', 'fr'],
          'tgt-9',
        ),
      );
    });

    it('does not crash when overwriting rejects', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('boom'));
      const markSynced = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', markSynced })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() => expect(papi.commands.sendCommand).toHaveBeenCalled());
      expect(markSynced).not.toHaveBeenCalled();
    });

    it('calls setModal with none when the save-as modal is closed', async () => {
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', setModal })} />);
      await userEvent.click(screen.getByTestId('saveas-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });
  });

  describe('metadata flow', () => {
    it('calls setModal with none when the metadata modal closes without a select source', async () => {
      const setModal = jest.fn();
      render(
        <ProjectModals
          {...buildProps({ modal: 'metadata', activeProject: MOCK_PROJECT, setModal })}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-close'));
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('returns to the select modal on close when opened via view info', async () => {
      const setModal = jest.fn();
      const useWebViewState = makeWebViewState();
      const { rerender } = render(
        <ProjectModals {...buildProps({ modal: 'select', setModal, useWebViewState })} />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(<ProjectModals {...buildProps({ modal: 'metadata', setModal, useWebViewState })} />);
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-close'));
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('updates the active project when the saved project is the active one', async () => {
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('metadata-save'));
      // The saved edits ({ name: 'Updated', analysisLanguages: ['fr'] }) are merged onto the active
      // project, so a regression that drops the update branch (ProjectModals.tsx:142) is caught here.
      expect(setActiveProject).toHaveBeenCalledWith({
        ...MOCK_PROJECT,
        name: 'Updated',
        analysisLanguages: ['fr'],
      });
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('does not update the active project when the saved project is a different one', async () => {
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      const useWebViewState = makeWebViewStateWithActiveProjectSpies({ set: setActiveProject });
      const { rerender } = render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState,
          })}
        />,
      );
      // View info for proj-2 while proj-1 is the active project, so the saved id differs.
      await userEvent.click(screen.getByTestId('select-view-info-2'));
      rerender(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState,
          })}
        />,
      );
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-save'));
      // The id guard (ProjectModals.tsx:141) skips the update because the saved project (proj-2)
      // is not the active one (proj-1); dropping that guard would call setActiveProject and fail.
      expect(setActiveProject).not.toHaveBeenCalled();
      // Opened via the select modal's info icon, so closing returns to the select modal.
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('does not update the active project when there is none on save', async () => {
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      const useWebViewState = makeWebViewStateWithActiveProjectSpies({ set: setActiveProject });
      const { rerender } = render(
        <ProjectModals {...buildProps({ modal: 'select', setModal, useWebViewState })} />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(<ProjectModals {...buildProps({ modal: 'metadata', setModal, useWebViewState })} />);
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-save'));
      // With no active project, the `activeProject &&` guard (ProjectModals.tsx:141) short-circuits;
      // dropping that guard would dereference/update the active project and call setActiveProject.
      expect(setActiveProject).not.toHaveBeenCalled();
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('resets the active project when the deleted project is the active one', async () => {
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      // Delete targets MOCK_PROJECT.id, which is the active project, so reset must fire.
      await userEvent.click(screen.getByTestId('metadata-delete'));
      // A regression that drops the reset (ProjectModals.tsx:156) is caught here.
      expect(resetActiveProject).toHaveBeenCalledTimes(1);
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('does not reset the active project when a different project is deleted', async () => {
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      const useWebViewState = makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject });
      const { rerender } = render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState,
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('select-view-info-2'));
      rerender(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState,
          })}
        />,
      );
      setModal.mockClear();
      // Delete targets proj-2 while proj-1 is active, so the id guard must skip the reset.
      await userEvent.click(screen.getByTestId('metadata-delete-2'));
      // The id guard (ProjectModals.tsx:156) prevents the reset; removing it would reset proj-1.
      expect(resetActiveProject).not.toHaveBeenCalled();
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('does not reset the active project when there is none on delete', async () => {
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      const useWebViewState = makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject });
      const { rerender } = render(
        <ProjectModals {...buildProps({ modal: 'select', setModal, useWebViewState })} />,
      );
      await userEvent.click(screen.getByTestId('select-view-info'));
      rerender(<ProjectModals {...buildProps({ modal: 'metadata', setModal, useWebViewState })} />);
      setModal.mockClear();
      await userEvent.click(screen.getByTestId('metadata-delete'));
      // With no active project, the `activeProject?.id === deletedId` guard (ProjectModals.tsx:156)
      // is false, so no reset fires; a regression that always resets would call resetActiveProject.
      expect(resetActiveProject).not.toHaveBeenCalled();
      expect(setModal).toHaveBeenCalledWith('select');
    });

    it('prefers the metadata project over the active project when both are set', async () => {
      const setModal = jest.fn();
      const useWebViewState = makeWebViewState();
      const { rerender } = render(
        <ProjectModals {...buildProps({ modal: 'select', setModal, useWebViewState })} />,
      );
      await userEvent.click(screen.getByTestId('select-view-info-2'));
      rerender(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState,
          })}
        />,
      );
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });
  });
});
