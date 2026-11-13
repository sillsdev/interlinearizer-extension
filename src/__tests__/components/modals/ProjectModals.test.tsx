/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { ModalState } from '../../../components/modals/ProjectModals';
import ProjectModals from '../../../components/modals/ProjectModals';
import type { DraftCopyResult } from '../../../types/project-api';
import { emptyAnalysis } from '../../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../../types/model-version';
import type { InterlinearProjectSummary } from '../../../types/interlinear-project-summary';
import type { TextCountsByTag } from '../../../utils/text-counts';
import { makeWebViewState } from '../../test-helpers';

/** Minimal project summary used in tests. */
const MOCK_PROJECT: InterlinearProjectSummary = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  sourceProjectId: 'source-proj',
  analysisLanguages: ['en'],
  name: 'My Project',
};

const MOCK_PROJECT_2: InterlinearProjectSummary = {
  id: 'proj-2',
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  sourceProjectId: 'source-proj',
  analysisLanguages: ['fr'],
  name: 'French Project',
};

/** A Paratext 9 import row, which the select modal routes to `onOpenImport`, not the draft. */
const MOCK_IMPORT_PROJECT: InterlinearProjectSummary = {
  ...MOCK_PROJECT,
  id: 'import-1',
  pt9Import: { fileHashes: {}, importedAt: '2026-08-01T00:00:00.000Z' },
};

/** A full project (with analysis), as the mocked project-creating commands return. */
const MOCK_FULL_PROJECT = { ...MOCK_PROJECT, analysis: emptyAnalysis() };

/** The strings ProjectModals and the real RetagGlossesConfirm format. */
const LOCALIZED: Record<string, string> = {
  '%interlinearizer_retagGlosses_changed%': 'Changed {from} to {to}.',
  '%interlinearizer_retagGlosses_movedWords%': '{words} words.',
  '%interlinearizer_retagGlosses_movedMorphemes%': '{morphemes} morphemes.',
  '%interlinearizer_retagGlosses_movedFreeTranslations%': '{freeTranslations} free translations.',
  '%interlinearizer_retagGlosses_skipped%': '{skipped} kept {from}.',
  '%interlinearizer_confirm_retag_title%': 'Move glosses to {to}?',
  '%interlinearizer_confirm_retag_body%': '{from} was removed. Move its glosses to {to}?',
  '%interlinearizer_confirm_retag_noUndo%': 'Not undoable.',
  '%interlinearizer_confirm_retag_ok%': 'Move to {to}',
  '%interlinearizer_confirm_retag_cancel%': 'Keep in {from}',
};

/** The analysis languages the mocked metadata modal saves; a test may set its own. */
let mockSavedLanguages = ['fr'];
/** What the mocked metadata modal's count button last got from `countText`. */
let mockCounted: Promise<TextCountsByTag> | undefined;

/** Draft snapshot returned by the default `getDraftSnapshot`. */
const MOCK_DRAFT: DraftProject = {
  sourceProjectId: 'source-proj',
  modelVersion: CURRENT_MODEL_VERSION,
  analysisLanguages: ['en'],
  analysis: emptyAnalysis(),
  dirty: true,
  suggestedDescription: 'Suggested Desc',
};

jest.mock('../../../components/modals/SelectInterlinearProjectModal', () => ({
  __esModule: true,
  SelectInterlinearProjectModal: ({
    isOpening,
    onSelect,
    onCreateNew,
    onClose,
    onViewInfo,
    onProjectDeleted,
  }: {
    isOpening?: boolean;
    onSelect: (p: InterlinearProjectSummary) => void;
    onCreateNew: () => void;
    onClose: () => void;
    onViewInfo: (p: InterlinearProjectSummary) => void;
    onProjectDeleted: (id: string) => void;
  }) => (
    <div data-testid="select-modal" data-is-opening={String(isOpening)}>
      <button type="button" data-testid="select-select" onClick={() => onSelect(MOCK_PROJECT)}>
        Select
      </button>
      <button type="button" data-testid="select-select-2" onClick={() => onSelect(MOCK_PROJECT_2)}>
        Select 2
      </button>
      <button
        type="button"
        data-testid="select-select-import"
        onClick={() => onSelect(MOCK_IMPORT_PROJECT)}
      >
        Select import
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
      <button
        type="button"
        data-testid="select-delete"
        onClick={() => onProjectDeleted(MOCK_PROJECT.id)}
      >
        Delete
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
    activeProjectId,
    activeProjectName,
    onSaveNew,
    onOverwrite,
    onClose,
  }: {
    activeProjectId?: string;
    activeProjectName?: string;
    onSaveNew: (name?: string, description?: string) => void;
    onOverwrite: (p: InterlinearProjectSummary) => void;
    onClose: () => void;
  }) => (
    <div
      data-active-project-id={activeProjectId}
      data-active-project-name={activeProjectName}
      data-testid="saveas-modal"
    >
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
    analysisLanguages,
    storedAnalysisLanguages,
    isSaveBlocked,
    countText,
    onClose,
    onProjectSaved,
  }: {
    analysisLanguages: string[];
    storedAnalysisLanguages?: string[];
    isSaveBlocked?: boolean;
    countText?: (tags: string[]) => Promise<TextCountsByTag>;
    onClose: () => void;
    onProjectSaved?: (u: {
      name?: string;
      description?: string;
      analysisLanguages: string[];
      updatedAt?: string;
    }) => void;
  }) => (
    <div
      data-testid="metadata-modal"
      data-languages={analysisLanguages.join(',')}
      data-stored-languages={storedAnalysisLanguages?.join(',')}
    >
      <button type="button" data-testid="metadata-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="metadata-count"
        onClick={() => {
          mockCounted = countText?.(['fr', 'de']);
        }}
      >
        Count
      </button>
      <button
        type="button"
        data-testid="metadata-save"
        disabled={isSaveBlocked}
        onClick={() => {
          onProjectSaved?.({
            name: 'Updated',
            analysisLanguages: mockSavedLanguages,
            updatedAt: '2026-06-15T09:00:00Z',
          });
          onClose();
        }}
      >
        Save
      </button>
    </div>
  ),
}));

jest.mock('../../../components/modals/DeleteProjectConfirm', () => ({
  __esModule: true,
  DeleteProjectConfirm: ({
    projectId,
    projectName,
    isPt9Import,
    onCancel,
    onDeleted,
  }: {
    projectId: string;
    projectName?: string;
    isPt9Import: boolean;
    onCancel: () => void;
    onDeleted: (id: string) => void;
  }) => (
    <div
      data-testid="delete-confirm"
      data-project-name={projectName}
      data-pt9-import={String(isPt9Import)}
    >
      <button type="button" data-testid="delete-confirm-cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" data-testid="delete-confirm-ok" onClick={() => onDeleted(projectId)}>
        Delete
      </button>
    </div>
  ),
}));

/** Props accepted by {@link buildProps}, mirroring ProjectModals' own props. */
type ModalsOverrides = Partial<{
  activeProject: InterlinearProjectSummary | undefined;
  announceUndoable: jest.Mock;
  changeDraftAnalysisLanguages: jest.Mock;
  defaultAnalysisLanguage: string;
  isDraftLoading: boolean;
  hasUnsavedWork: boolean;
  getDraftSnapshot: () => DraftProject | undefined;
  detachFromProject: jest.Mock;
  commitDraft: (
    copy: (snapshot: DraftProject, sessionId: string) => Promise<DraftCopyResult>,
  ) => Promise<boolean>;
  loadFromProject: jest.Mock;
  newDraft: jest.Mock;
  modal: ModalState;
  onImportPt9: jest.Mock;
  onOpenImport: jest.Mock;
  openRequest: { project: InterlinearProjectSummary; requestId: number };
  setModal: jest.Mock;
  useWebViewState: ReturnType<typeof makeWebViewState>;
}>;

/** The session that the draft in these tests is kept in. */
const SESSION_ID = 'session-1';

/**
 * Builds a complete ProjectModals prop set, filling required props with sensible defaults so each
 * test only specifies what it cares about.
 */
function buildProps(overrides: ModalsOverrides = {}) {
  const getDraftSnapshot = overrides.getDraftSnapshot ?? (() => MOCK_DRAFT);
  return {
    activeProject: overrides.activeProject,
    announceUndoable: overrides.announceUndoable ?? jest.fn(),
    changeDraftAnalysisLanguages:
      overrides.changeDraftAnalysisLanguages ?? jest.fn().mockResolvedValue(undefined),
    defaultAnalysisLanguage: overrides.defaultAnalysisLanguage,
    hasUnsavedWork: overrides.hasUnsavedWork ?? false,
    isDraftLoading: overrides.isDraftLoading ?? false,
    getDraftSnapshot,
    detachFromProject: overrides.detachFromProject ?? jest.fn(),
    commitDraft:
      overrides.commitDraft ??
      (async (copy) => {
        const snapshot = getDraftSnapshot();
        return snapshot ? (await copy(snapshot, SESSION_ID)) !== false : false;
      }),
    loadFromProject: overrides.loadFromProject ?? jest.fn(),
    newDraft: overrides.newDraft ?? jest.fn(),
    modal: overrides.modal ?? 'none',
    onImportPt9: overrides.onImportPt9 ?? jest.fn(),
    onOpenImport: overrides.onOpenImport ?? jest.fn(),
    openRequest: overrides.openRequest,
    projectId: 'source-proj',
    setModal: overrides.setModal ?? jest.fn(),
    sourceShortName: 'SRC',
    useWebViewState: overrides.useWebViewState ?? makeWebViewState(),
  };
}

/** The host's Save As reply for `project`, having left `omittedBooks` out. */
function savedAs(project: InterlinearProjectSummary, omittedBooks: string[] = []): string {
  return JSON.stringify({ project, omittedBooks });
}

/**
 * A `commitDraft` that runs the copy on {@link MOCK_DRAFT}, under `sessionId`. It records what each
 * copy resolved, so a test can tell whether the draft would count each save as landed.
 */
function recordingCommitDraft(sessionId = SESSION_ID) {
  const outcomes: DraftCopyResult[] = [];
  const commitDraft = jest.fn(
    async (copy: (s: DraftProject, session: string) => Promise<DraftCopyResult>) => {
      const copied = await copy(MOCK_DRAFT, sessionId);
      outcomes.push(copied);
      return copied !== false;
    },
  );
  return { commitDraft, outcomes };
}

/**
 * A `commitDraft` that holds the save until the returned `release` runs the copy on `MOCK_DRAFT`,
 * standing in for the draft's writes still settling.
 */
function heldCommitDraft() {
  let release!: () => void;
  const commitDraft = jest.fn(
    (copy: (s: DraftProject, session: string) => Promise<DraftCopyResult>) =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(copy(MOCK_DRAFT, SESSION_ID).then((copied) => copied !== false));
      }),
  );
  return { commitDraft, release: () => release() };
}

/**
 * Builds a `useWebViewState` stub with optional spies on the setter and/or reset for the
 * `'activeProject'` key, so a test can assert how the active project was updated or cleared. Any
 * unspecified spy — and every key other than `'activeProject'` — gets a no-op. Mirrors
 * {@link makeWebViewState}'s `[value, setter, reset]` shape without type assertions.
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

beforeEach(() => {
  jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  mockSavedLanguages = ['fr'];
});

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

    it('renders the save-as modal with the active project name when modal is saveAs', () => {
      render(<ProjectModals {...buildProps({ modal: 'saveAs', activeProject: MOCK_PROJECT })} />);
      expect(screen.getByTestId('saveas-modal')).toHaveAttribute(
        'data-active-project-name',
        MOCK_PROJECT.name,
      );
    });

    it('forwards the active project id to the save-as modal so it can badge that overwrite target', () => {
      render(<ProjectModals {...buildProps({ modal: 'saveAs', activeProject: MOCK_PROJECT })} />);
      expect(screen.getByTestId('saveas-modal')).toHaveAttribute(
        'data-active-project-id',
        'proj-1',
      );
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
    it('loads the chosen project into the draft by id and closes when not dirty', async () => {
      const loadFromProject = jest.fn();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject, setModal })} />);

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() => expect(setModal).toHaveBeenCalledWith('none'));
      expect(loadFromProject).toHaveBeenCalledWith('proj-1');
    });

    it('keeps the active project and the modal when the draft cannot be replaced', async () => {
      const loadFromProject = jest.fn().mockRejectedValue(new Error('disk full'));
      const setModal = jest.fn();
      const setActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            loadFromProject,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('select-select'));

      await waitFor(() =>
        expect(papi.notifications.send).toHaveBeenCalledWith({
          message: '%interlinearizer_error_load_projects_failed%',
          severity: 'error',
        }),
      );
      expect(setActiveProject).not.toHaveBeenCalled();
      expect(setModal).not.toHaveBeenCalledWith('none');
    });

    it('marks the select modal as opening while the chosen project loads, and clears it after', async () => {
      let finishLoad: () => void = () => {};
      const loadFromProject = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishLoad = resolve;
          }),
      );
      render(<ProjectModals {...buildProps({ modal: 'select', loadFromProject })} />);
      expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'false');

      await userEvent.click(screen.getByTestId('select-select'));
      await waitFor(() =>
        expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'true'),
      );

      finishLoad();
      await waitFor(() =>
        expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'false'),
      );
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
      // createProject returns a FULL project (analysis included); only its summary should be cached.
      jest
        .mocked(papi.commands.sendCommand)
        .mockResolvedValueOnce(JSON.stringify(MOCK_FULL_PROJECT));
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
      expect(setActiveProject.mock.calls[0][0]).not.toHaveProperty('analysis');
      expect(newDraft).toHaveBeenCalledWith({
        analysisLanguages: ['en'],
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

    it('creates no project and keeps the modal open when the draft cannot be replaced', async () => {
      const newDraft = jest.fn().mockRejectedValue(new Error('disk full'));
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'create', newDraft, setModal })} />);

      await userEvent.click(screen.getByTestId('create-submit'));

      await waitFor(() =>
        expect(papi.notifications.send).toHaveBeenCalledWith({
          message: '%interlinearizer_error_create_project_failed%',
          severity: 'error',
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to start the draft from New dialog',
        expect.any(Error),
      );
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();
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
      const loadFromProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({ modal: 'select', hasUnsavedWork: true, loadFromProject })}
        />,
      );

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
      render(
        <ProjectModals
          {...buildProps({ modal: 'select', hasUnsavedWork: true, loadFromProject })}
        />,
      );

      await userEvent.click(screen.getByTestId('select-select'));
      await userEvent.click(screen.getByTestId('discard-cancel'));

      expect(screen.queryByTestId('discard-modal')).toBeNull();
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
      expect(loadFromProject).not.toHaveBeenCalled();
    });

    it('confirms before creating a project when the draft is dirty', async () => {
      const newDraft = jest.fn();
      render(
        <ProjectModals {...buildProps({ modal: 'create', hasUnsavedWork: true, newDraft })} />,
      );

      await userEvent.click(screen.getByTestId('create-submit'));
      expect(screen.getByTestId('discard-modal')).toBeInTheDocument();
      // Neither draft nor project creation should start until the user confirms discarding.
      expect(newDraft).not.toHaveBeenCalled();
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('discard-confirm'));
      await waitFor(() =>
        expect(newDraft).toHaveBeenCalledWith({
          analysisLanguages: ['en'],
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
            hasUnsavedWork: true,
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
      let finishLoad: () => void = () => {};
      const loadFromProject = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishLoad = resolve;
          }),
      );
      render(
        <ProjectModals
          {...buildProps({ modal: 'select', hasUnsavedWork: true, loadFromProject })}
        />,
      );

      await userEvent.click(screen.getByTestId('select-select'));
      expect(screen.getByTestId('discard-confirm')).toBeEnabled();

      await userEvent.click(screen.getByTestId('discard-confirm'));
      expect(screen.getByTestId('discard-confirm')).toBeDisabled();

      finishLoad();
      await waitFor(() => expect(screen.queryByTestId('discard-modal')).toBeNull());
    });
  });

  describe('save as flow', () => {
    it('has the host create a project from the stored draft through commitDraft, and closes', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(savedAs(MOCK_PROJECT));
      const { commitDraft, outcomes } = recordingCommitDraft();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(setModal).toHaveBeenCalledWith('none'));
      // One command carrying only metadata: the host copies the analysis from the stored draft.
      expect(papi.commands.sendCommand).toHaveBeenCalledTimes(1);
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftAsProject',
        SESSION_ID,
        'source-proj',
        ['en'],
        undefined,
        'NewName',
        'NewDesc',
      );
      // The copy landed, so the draft counts the save.
      expect(outcomes).toEqual([true]);
    });

    it('saves as a new project through the session that keeps the draft', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(savedAs(MOCK_PROJECT));
      const { commitDraft } = recordingCommitDraft();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.saveDraftAsProject',
          SESSION_ID,
          'source-proj',
          ['en'],
          undefined,
          'NewName',
          'NewDesc',
        ),
      );
    });

    it('reports a copy that left books out as partial, and closes', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(savedAs(MOCK_PROJECT, ['JHN']));
      const { commitDraft, outcomes } = recordingCommitDraft();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(setModal).toHaveBeenCalledWith('none'));
      expect(outcomes).toEqual(['partial']);
    });

    it('sends nothing until the draft lets the save run', async () => {
      const { commitDraft, release } = heldCommitDraft();
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(savedAs(MOCK_PROJECT));
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));
      expect(commitDraft).toHaveBeenCalledTimes(1);
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();

      await act(async () => release());
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftAsProject',
        SESSION_ID,
        'source-proj',
        ['en'],
        undefined,
        'NewName',
        'NewDesc',
      );
    });

    it('does not save as a new project when the draft cannot settle its writes', async () => {
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            commitDraft: () => Promise.reject(new Error('disk full')),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Interlinearizer: failed to save draft as new project',
          expect.any(Error),
        ),
      );
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();
    });

    it('caches only the summary of the created project on Save As New', async () => {
      const setActiveProject = jest.fn();
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(savedAs(MOCK_FULL_PROJECT));
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(setActiveProject).toHaveBeenCalledWith(MOCK_PROJECT));
      expect(setActiveProject.mock.calls[0][0]).not.toHaveProperty('analysis');
    });

    it('notifies and reports the save as not landed when save as new returns a non-project shape', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify({ bad: true }));
      const { commitDraft, outcomes } = recordingCommitDraft();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() => expect(papi.notifications.send).toHaveBeenCalledTimes(1));
      expect(outcomes).toEqual([false]);
      expect(setModal).not.toHaveBeenCalled();
    });

    it('logs and keeps the modal open when saving a new project rejects', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('boom'));
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-new'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Interlinearizer: failed to save draft as new project',
          expect.any(Error),
        ),
      );
      expect(setModal).not.toHaveBeenCalled();
    });

    it('has the host copy the stored draft into an existing project through commitDraft, and closes', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      const { commitDraft, outcomes } = recordingCommitDraft();
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft, setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() => expect(setModal).toHaveBeenCalledWith('none'));
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftToProject',
        SESSION_ID,
        'source-proj',
        'proj-1',
        { targetProjectId: undefined },
      );
      expect(outcomes).toEqual([true]);
    });

    it('overwrites a project through the session that keeps the draft', async () => {
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      const { commitDraft } = recordingCommitDraft();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.saveDraftToProject',
          SESSION_ID,
          'source-proj',
          'proj-1',
          { targetProjectId: undefined },
        ),
      );
    });

    it('sends no overwrite until the draft lets the save run', async () => {
      const { commitDraft, release } = heldCommitDraft();
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(MOCK_PROJECT));
      render(<ProjectModals {...buildProps({ modal: 'saveAs', commitDraft })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));
      expect(commitDraft).toHaveBeenCalledTimes(1);
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();

      await act(async () => release());
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftToProject',
        SESSION_ID,
        'source-proj',
        'proj-1',
        { targetProjectId: undefined },
      );
    });

    it('does not overwrite an existing project when the draft cannot settle its writes', async () => {
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            commitDraft: () => Promise.reject(new Error('disk full')),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Interlinearizer: failed to overwrite project with draft',
          expect.any(Error),
        ),
      );
      expect(papi.commands.sendCommand).not.toHaveBeenCalled();
    });

    it('caches only the summary of the server-returned project (with its refreshed updatedAt) on overwrite', async () => {
      const setActiveProject = jest.fn();
      // The host returns a FULL project (analysis included) with a bumped updatedAt.
      const refreshedFull = { ...MOCK_FULL_PROJECT, updatedAt: '2026-06-15T09:00:00Z' };
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify(refreshedFull));
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      // The bumped updatedAt (not the seeded one) proves the server response was preferred over the
      // pre-save fallback; projecting it to a summary drops the analysis.
      await waitFor(() =>
        expect(setActiveProject).toHaveBeenCalledWith({
          ...MOCK_PROJECT,
          updatedAt: '2026-06-15T09:00:00Z',
        }),
      );
      expect(setActiveProject.mock.calls[0][0]).not.toHaveProperty('analysis');
    });

    it('logs and keeps the modal open when the overwrite payload is malformed', async () => {
      const setActiveProject = jest.fn();
      const setModal = jest.fn();
      jest.mocked(papi.commands.sendCommand).mockResolvedValueOnce(JSON.stringify({ bad: true }));
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Interlinearizer: failed to overwrite project with draft',
          expect.any(Error),
        ),
      );
      expect(setActiveProject).not.toHaveBeenCalled();
      expect(setModal).not.toHaveBeenCalled();
    });

    it('tells the user and leaves the modal open when the overwritten project is gone', async () => {
      const setActiveProject = jest.fn();
      const { commitDraft, outcomes } = recordingCommitDraft();
      const setModal = jest.fn();
      // The command resolves undefined (the blanket default): the project no longer exists.
      render(
        <ProjectModals
          {...buildProps({
            modal: 'saveAs',
            commitDraft,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ set: setActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(papi.notifications.send).toHaveBeenCalledWith({
          message: '%interlinearizer_error_save_project_missing%',
          severity: 'error',
        }),
      );
      expect(setActiveProject).not.toHaveBeenCalled();
      // Nothing landed, so the draft stays dirty.
      expect(outcomes).toEqual([false]);
      expect(setModal).not.toHaveBeenCalled();
    });

    it("sends the draft's target with the overwrite so the host sets it in the same write", async () => {
      const draftWithConfig: DraftProject = {
        sourceProjectId: 'source-proj',
        modelVersion: CURRENT_MODEL_VERSION,
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

      // One command carries the draft's alignment target; the host takes the languages from the
      // stored draft. The project's own name and description are not sent, so the host keeps them.
      await waitFor(() =>
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.saveDraftToProject',
          SESSION_ID,
          'source-proj',
          'proj-1',
          { targetProjectId: 'tgt-9' },
        ),
      );
      expect(papi.commands.sendCommand).toHaveBeenCalledTimes(1);
    });

    it('logs and keeps the modal open when overwriting rejects', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('boom'));
      const setModal = jest.fn();
      render(<ProjectModals {...buildProps({ modal: 'saveAs', setModal })} />);

      await userEvent.click(screen.getByTestId('saveas-overwrite'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Interlinearizer: failed to overwrite project with draft',
          expect.any(Error),
        ),
      );
      expect(setModal).not.toHaveBeenCalled();
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
      // The saved name and the server-refreshed updatedAt are merged onto the active project. Its
      // languages stay as stored, because the draft holds the new ones until it is saved.
      expect(setActiveProject).toHaveBeenCalledWith({
        ...MOCK_PROJECT,
        name: 'Updated',
        updatedAt: '2026-06-15T09:00:00Z',
      });
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it("shows the open project's languages from its draft, keeping the stored ones in storage", () => {
      render(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_PROJECT,
            getDraftSnapshot: () => ({ ...MOCK_DRAFT, analysisLanguages: ['fr', 'en'] }),
          })}
        />,
      );

      const modal = screen.getByTestId('metadata-modal');
      expect(modal).toHaveAttribute('data-languages', 'fr,en');
      expect(modal).toHaveAttribute('data-stored-languages', 'en');
    });

    it("shows an open import's own languages, which no draft holds", () => {
      render(
        <ProjectModals
          {...buildProps({
            modal: 'metadata',
            activeProject: MOCK_IMPORT_PROJECT,
            getDraftSnapshot: () => ({ ...MOCK_DRAFT, analysisLanguages: ['fr'] }),
          })}
        />,
      );

      const modal = screen.getByTestId('metadata-modal');
      expect(modal).toHaveAttribute('data-languages', 'en');
      expect(modal).not.toHaveAttribute('data-stored-languages');
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
      // The id guard skips the update because the saved project (proj-2) is not the active one (proj-1).
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
      // With no active project, the `activeProject &&` guard short-circuits.
      expect(setActiveProject).not.toHaveBeenCalled();
      expect(setModal).toHaveBeenCalledWith('select');
    });

    describe('a change of analysis languages', () => {
      const MOVED = { words: 3, morphemes: 2, freeTranslations: 0, skipped: 0 };

      /** An analysis with one word glossed in `tag`. */
      function glossedIn(tag: string): TextAnalysis {
        return {
          ...emptyAnalysis(),
          tokenAnalyses: [
            {
              id: 'ta-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'fish',
              gloss: { [tag]: 'fish' },
            },
          ],
        };
      }

      /**
       * Renders the metadata modal for the active project, whose draft is in `en`. The draft has a
       * gloss in `en` unless `draft` says otherwise.
       */
      function renderActive(
        changeDraftAnalysisLanguages: jest.Mock,
        announceUndoable = jest.fn(),
        draft: DraftProject = { ...MOCK_DRAFT, analysis: glossedIn('en') },
      ) {
        render(
          <ProjectModals
            {...buildProps({
              modal: 'metadata',
              activeProject: MOCK_PROJECT,
              changeDraftAnalysisLanguages,
              announceUndoable,
              getDraftSnapshot: () => draft,
            })}
          />,
        );
      }

      /**
       * Answers `countProjectText` with `glossCount` glosses in `fr`, by default one, and
       * `retagProjectGlosses` with `retagged`. An error is thrown instead of answered.
       */
      function mockStoredProject({
        glossCount = 1,
        retagged,
      }: {
        glossCount?: number | Error;
        retagged?: string | Error;
      } = {}) {
        const replies: Record<string, string | Error | undefined> = {
          'interlinearizer.countProjectText':
            glossCount instanceof Error
              ? glossCount
              : JSON.stringify({ fr: { glosses: glossCount, freeTranslations: 0 } }),
          'interlinearizer.retagProjectGlosses': retagged,
        };
        jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call: unknown[]) => {
          const reply = replies[String(call[0])];
          if (reply instanceof Error) throw reply;
          return reply;
        });
      }

      /** Renders the metadata modal for proj-2, in `fr`, while proj-1 is active. */
      async function renderOther(isDraftLoading = false) {
        const useWebViewState = makeWebViewState();
        const changeDraftAnalysisLanguages = jest.fn().mockResolvedValue(undefined);
        const props = {
          activeProject: MOCK_PROJECT,
          useWebViewState,
          changeDraftAnalysisLanguages,
          isDraftLoading,
        };
        const { rerender } = render(
          <ProjectModals {...buildProps({ ...props, modal: 'select' })} />,
        );
        await userEvent.click(screen.getByTestId('select-view-info-2'));
        rerender(<ProjectModals {...buildProps({ ...props, modal: 'metadata' })} />);
        return changeDraftAnalysisLanguages;
      }

      it("can't save the open project until its draft has loaded", () => {
        render(
          <ProjectModals
            {...buildProps({
              modal: 'metadata',
              activeProject: MOCK_PROJECT,
              isDraftLoading: true,
            })}
          />,
        );

        expect(screen.getByTestId('metadata-save')).toBeDisabled();
      });

      it('saves another project while the draft loads', async () => {
        await renderOther(true);

        expect(screen.getByTestId('metadata-save')).toBeEnabled();
      });

      it('moves the glosses of a dropped primary language in the draft and offers to undo', async () => {
        mockSavedLanguages = ['fr'];
        const change = jest.fn().mockResolvedValue(MOVED);
        const announceUndoable = jest.fn();
        renderActive(change, announceUndoable);

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(change).toHaveBeenCalledWith(['fr'], 'en');
        expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull();
        await waitFor(() =>
          expect(announceUndoable).toHaveBeenCalledWith('Changed en to fr. 3 words. 2 morphemes.'),
        );
      });

      it('neither moves nor announces when the draft has no gloss in a dropped primary language', async () => {
        mockSavedLanguages = ['fr'];
        const change = jest.fn().mockResolvedValue(undefined);
        const announceUndoable = jest.fn();
        renderActive(change, announceUndoable, MOCK_DRAFT);

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(change).toHaveBeenCalledWith(['fr'], undefined);
        expect(announceUndoable).not.toHaveBeenCalled();
      });

      it('moves the free translations of a dropped primary language that has no glosses', async () => {
        mockSavedLanguages = ['fr'];
        const change = jest
          .fn()
          .mockResolvedValue({ words: 0, morphemes: 0, freeTranslations: 1, skipped: 0 });
        const announceUndoable = jest.fn();
        renderActive(change, announceUndoable, {
          ...MOCK_DRAFT,
          analysis: {
            ...emptyAnalysis(),
            segmentAnalyses: [
              {
                id: 'sa-1',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                surfaceText: 'Fish.',
                freeTranslation: { en: 'Fish.' },
              },
            ],
          },
        });

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(change).toHaveBeenCalledWith(['fr'], 'en');
        await waitFor(() =>
          expect(announceUndoable).toHaveBeenCalledWith('Changed en to fr. 1 free translations.'),
        );
      });

      it('changes only the draft languages when the old primary language stays listed', async () => {
        mockSavedLanguages = ['fr', 'en'];
        const change = jest.fn().mockResolvedValue(undefined);
        renderActive(change);

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull();
        expect(change).toHaveBeenCalledWith(['fr', 'en'], undefined);
      });

      it('announces nothing when the move moved nothing', async () => {
        mockSavedLanguages = ['fr'];
        const change = jest
          .fn()
          .mockResolvedValue({ words: 0, morphemes: 0, freeTranslations: 0, skipped: 2 });
        const announceUndoable = jest.fn();
        renderActive(change, announceUndoable);

        await userEvent.click(screen.getByTestId('metadata-save'));

        await waitFor(() => expect(change).toHaveBeenCalledWith(['fr'], 'en'));
        expect(announceUndoable).not.toHaveBeenCalled();
      });

      it('says how many glosses stayed because the new language already had one', async () => {
        const change = jest.fn().mockResolvedValue({ ...MOVED, skipped: 4 });
        const announceUndoable = jest.fn();
        renderActive(change, announceUndoable);

        await userEvent.click(screen.getByTestId('metadata-save'));

        await waitFor(() =>
          expect(announceUndoable).toHaveBeenCalledWith(
            'Changed en to fr. 3 words. 2 morphemes. 4 kept en.',
          ),
        );
      });

      it('gives the draft languages that keep its primary language without moving glosses', async () => {
        mockSavedLanguages = ['en', 'fr'];
        const change = jest.fn().mockResolvedValue(undefined);
        renderActive(change);

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(change).toHaveBeenCalledWith(['en', 'fr'], undefined);
        expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull();
      });

      it('leaves the draft alone when its languages are unchanged', async () => {
        mockSavedLanguages = ['en'];
        const change = jest.fn();
        renderActive(change);

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(change).not.toHaveBeenCalled();
      });

      it('logs a draft change that fails', async () => {
        const change = jest.fn().mockRejectedValue(new Error('refused'));
        renderActive(change);

        await userEvent.click(screen.getByTestId('metadata-save'));

        await waitFor(() =>
          expect(logger.error).toHaveBeenCalledWith(
            "Interlinearizer: failed to change the draft's analysis languages",
            expect.any(Error),
          ),
        );
      });

      it("asks before moving a project's glosses when it isn't open, and reports the move", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject({
          retagged: JSON.stringify({ words: 5, morphemes: 0, freeTranslations: 0, skipped: 0 }),
        });
        const change = await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));
        expect(await screen.findByTestId('retag-glosses-no-undo')).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('retag-glosses-confirm'));

        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.retagProjectGlosses',
          'proj-2',
          'fr',
          'es',
        );
        expect(papi.notifications.send).toHaveBeenCalledWith({
          message: 'Changed fr to es. 5 words.',
          severity: 'info',
        });
        expect(change).not.toHaveBeenCalled();
      });

      it("doesn't ask about a project that isn't open when its old primary language stays listed", async () => {
        mockSavedLanguages = ['es', 'fr'];
        mockStoredProject();
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull();
        expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
          'interlinearizer.countProjectText',
          expect.anything(),
          expect.anything(),
        );
      });

      it("doesn't ask about a project that isn't open when it has no gloss to move", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject({ glossCount: 0 });
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));

        await waitFor(() =>
          expect(papi.commands.sendCommand).toHaveBeenCalledWith(
            'interlinearizer.countProjectText',
            'proj-2',
            ['fr'],
          ),
        );
        expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull();
      });

      it("asks about a project that isn't open when it has only free translations to move", async () => {
        mockSavedLanguages = ['es'];
        jest
          .mocked(papi.commands.sendCommand)
          .mockImplementation(async (...call: unknown[]) =>
            call[0] === 'interlinearizer.countProjectText'
              ? JSON.stringify({ fr: { glosses: 0, freeTranslations: 2 } })
              : undefined,
          );
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(await screen.findByTestId('retag-glosses-modal-title')).toBeInTheDocument();
      });

      it("asks about a project that isn't open when it can't be read", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject({ glossCount: new Error('unreadable') });
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));

        expect(await screen.findByTestId('retag-glosses-modal-title')).toBeInTheDocument();
        expect(logger.warn).toHaveBeenCalledWith(
          "Interlinearizer: couldn't read a project to see whether it has glosses to move",
          expect.any(Error),
        );
      });

      it("reports nothing when a project that isn't open moved nothing", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject({
          retagged: JSON.stringify({ words: 0, morphemes: 0, freeTranslations: 0, skipped: 1 }),
        });
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));
        await userEvent.click(await screen.findByTestId('retag-glosses-confirm'));

        await waitFor(() => expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull());
        expect(papi.notifications.send).not.toHaveBeenCalled();
      });

      it("leaves a project's glosses when it isn't open and the user keeps them", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject();
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));
        await userEvent.click(await screen.findByRole('button', { name: 'Keep in fr' }));

        expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
          'interlinearizer.retagProjectGlosses',
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
        await waitFor(() => expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull());
      });

      it("reports nothing when the project isn't stored any more", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject();
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));
        await userEvent.click(await screen.findByTestId('retag-glosses-confirm'));

        await waitFor(() => expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull());
        expect(papi.notifications.send).not.toHaveBeenCalled();
      });

      it("logs a project's move that fails and keeps asking", async () => {
        mockSavedLanguages = ['es'];
        mockStoredProject({ retagged: new Error('disk full') });
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-save'));
        await userEvent.click(await screen.findByTestId('retag-glosses-confirm'));

        await waitFor(() =>
          expect(logger.error).toHaveBeenCalledWith(
            "Interlinearizer: failed to move a project's glosses",
            expect.any(Error),
          ),
        );
        expect(papi.notifications.send).not.toHaveBeenCalled();
        await userEvent.click(await screen.findByRole('button', { name: 'Keep in fr' }));
        await waitFor(() => expect(screen.queryByTestId('retag-glosses-modal-title')).toBeNull());
      });

      it("counts the glosses of a project that isn't open on the host", async () => {
        const counts = {
          fr: { glosses: 2, freeTranslations: 1 },
          de: { glosses: 0, freeTranslations: 0 },
        };
        jest.mocked(papi.commands.sendCommand).mockResolvedValue(JSON.stringify(counts));
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-count'));

        expect(await mockCounted).toStrictEqual(counts);
        expect(papi.commands.sendCommand).toHaveBeenCalledWith(
          'interlinearizer.countProjectText',
          'proj-2',
          ['fr', 'de'],
        );
      });

      it.each([
        ['the project is gone', undefined],
        ['the reply is malformed', JSON.stringify(['fr'])],
      ])("counts no glosses for a project that isn't open when %s", async (_case, reply) => {
        jest.mocked(papi.commands.sendCommand).mockResolvedValue(reply);
        await renderOther();

        await userEvent.click(screen.getByTestId('metadata-count'));

        expect(await mockCounted).toStrictEqual({});
      });

      it("counts the open project's glosses in its draft", async () => {
        renderActive(jest.fn(), jest.fn(), { ...MOCK_DRAFT, analysis: glossedIn('fr') });

        await userEvent.click(screen.getByTestId('metadata-count'));

        expect(await mockCounted).toStrictEqual({
          fr: { glosses: 1, freeTranslations: 0 },
          de: { glosses: 0, freeTranslations: 0 },
        });
        expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
          'interlinearizer.countProjectText',
          expect.anything(),
          expect.anything(),
        );
      });
    });

    it('asks to confirm deleting the active project', () => {
      render(<ProjectModals {...buildProps({ modal: 'delete', activeProject: MOCK_PROJECT })} />);
      const confirm = screen.getByTestId('delete-confirm');
      expect(confirm).toHaveAttribute('data-project-name', MOCK_PROJECT.name);
      expect(confirm).toHaveAttribute('data-pt9-import', 'false');
    });

    it('tells the delete confirmation when the active project is a Paratext 9 import', () => {
      render(
        <ProjectModals {...buildProps({ modal: 'delete', activeProject: MOCK_IMPORT_PROJECT })} />,
      );
      expect(screen.getByTestId('delete-confirm')).toHaveAttribute('data-pt9-import', 'true');
    });

    it('resets and detaches the active project once it is deleted', async () => {
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      const detachFromProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'delete',
            activeProject: MOCK_PROJECT,
            detachFromProject,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('delete-confirm-ok'));
      expect(resetActiveProject).toHaveBeenCalledTimes(1);
      expect(detachFromProject).toHaveBeenCalledTimes(1);
      expect(setModal).toHaveBeenCalledWith('none');
    });

    it('leaves the draft attached when the deleted active project is a Paratext 9 import', async () => {
      const resetActiveProject = jest.fn();
      const detachFromProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'delete',
            activeProject: MOCK_IMPORT_PROJECT,
            detachFromProject,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('delete-confirm-ok'));
      expect(resetActiveProject).toHaveBeenCalledTimes(1);
      expect(detachFromProject).not.toHaveBeenCalled();
    });

    it('closes without deleting when the delete confirmation is canceled', async () => {
      const setModal = jest.fn();
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'delete',
            activeProject: MOCK_PROJECT,
            setModal,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('delete-confirm-cancel'));
      expect(setModal).toHaveBeenCalledWith('none');
      expect(resetActiveProject).not.toHaveBeenCalled();
    });

    it('resets the active project when the select modal deletes it', async () => {
      const resetActiveProject = jest.fn();
      const detachFromProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            activeProject: MOCK_PROJECT,
            detachFromProject,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );

      await userEvent.click(screen.getByTestId('select-delete'));

      expect(resetActiveProject).toHaveBeenCalledTimes(1);
      expect(detachFromProject).toHaveBeenCalledTimes(1);
    });

    it('does not reset the active project when a different project is deleted', async () => {
      const resetActiveProject = jest.fn();
      const detachFromProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            activeProject: MOCK_PROJECT_2,
            detachFromProject,
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      // The select mock's Delete targets MOCK_PROJECT while MOCK_PROJECT_2 is active.
      await userEvent.click(screen.getByTestId('select-delete'));
      expect(resetActiveProject).not.toHaveBeenCalled();
      expect(detachFromProject).not.toHaveBeenCalled();
    });

    it('does not reset the active project when there is none on delete', async () => {
      const resetActiveProject = jest.fn();
      render(
        <ProjectModals
          {...buildProps({
            modal: 'select',
            useWebViewState: makeWebViewStateWithActiveProjectSpies({ reset: resetActiveProject }),
          })}
        />,
      );
      await userEvent.click(screen.getByTestId('select-delete'));
      expect(resetActiveProject).not.toHaveBeenCalled();
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

describe('ProjectModals Paratext 9 import routing', () => {
  beforeEach(() => {
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
  });

  it('routes an import row to onOpenImport without touching the draft-open flow', async () => {
    const onOpenImport = jest.fn();
    const imported = {
      ...MOCK_PROJECT,
      pt9Import: { fileHashes: {}, importedAt: '2026-08-01T00:00:00.000Z' },
    };
    render(
      <ProjectModals
        {...buildProps({ modal: 'select', hasUnsavedWork: true, onOpenImport: jest.fn() })}
        onOpenImport={onOpenImport}
        openRequest={{ project: imported, requestId: 1 }}
      />,
    );

    await waitFor(() => expect(onOpenImport).toHaveBeenCalledWith(imported));
    // The draft-open flow was bypassed entirely: no project fetch, no discard confirmation.
    expect(jest.mocked(papi.commands.sendCommand)).not.toHaveBeenCalled();
    expect(screen.queryByTestId('discard-modal')).not.toBeInTheDocument();
  });

  it('holds the picker inert while an import is opening', async () => {
    let finishOpen: (() => void) | undefined;
    const onOpenImport = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    render(<ProjectModals {...buildProps({ modal: 'select' })} onOpenImport={onOpenImport} />);
    expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'false');

    await userEvent.click(screen.getByTestId('select-select-import'));

    expect(onOpenImport).toHaveBeenCalledWith(MOCK_IMPORT_PROJECT);
    expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'true');

    await act(async () => {
      finishOpen?.();
    });

    expect(screen.getByTestId('select-modal')).toHaveAttribute('data-is-opening', 'false');
  });

  it('opens an openRequest project through the draft-open flow', async () => {
    jest
      .mocked(papi.commands.sendCommand)
      .mockResolvedValue(JSON.stringify({ ...MOCK_PROJECT, analysis: MOCK_DRAFT.analysis }));
    const loadFromProject = jest.fn();
    render(
      <ProjectModals
        {...buildProps({ loadFromProject })}
        openRequest={{ project: MOCK_PROJECT, requestId: 1 }}
      />,
    );

    await waitFor(() => expect(loadFromProject).toHaveBeenCalled());
  });
});

describe('ProjectModals metadata for an import', () => {
  it('renders the metadata modal for an import project', () => {
    const imported = {
      ...MOCK_PROJECT,
      pt9Import: { fileHashes: {}, importedAt: '2026-08-01T00:00:00.000Z' },
    };
    render(<ProjectModals {...buildProps({ modal: 'metadata', activeProject: imported })} />);

    expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
  });
});
