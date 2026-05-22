/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';
import { makeWebViewState } from '../test-helpers';

jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useOptimisticBooleanSetting');

jest.mock('../../components/ContinuousScrollToggle', () => ({
  __esModule: true,
  default: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <button
      aria-label="continuous scroll"
      data-testid="continuous-scroll-toggle"
      data-checked={String(checked)}
      data-disabled={String(disabled)}
      onClick={() => onCheckedChange(!checked)}
      type="button"
    />
  ),
}));

jest.mock('../../components/ScriptureNavControls', () => ({
  __esModule: true,
  default: () => <div data-testid="scripture-nav-controls" />,
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

type CapturedInterlinearizerProps = {
  continuousScroll: boolean;
  analysisLanguage: string | undefined;
};
let capturedInterlinearizerProps: CapturedInterlinearizerProps | undefined;

jest.mock('../../components/Interlinearizer', () => ({
  __esModule: true,
  default: (props: CapturedInterlinearizerProps) => {
    capturedInterlinearizerProps = props;
    return <div data-testid="interlinearizer" />;
  },
}));

/** Minimal project summary used across modal interaction tests. */
type MockProject = {
  id: string;
  createdAt: string;
  sourceProjectId: string;
  analysisLanguages: string[];
  name?: string;
  description?: string;
};

const testProjectId = 'test-project-id';

const STUB_ACTIVE_PROJECT: MockProject = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  sourceProjectId: testProjectId,
  analysisLanguages: ['en'],
  name: 'My Project',
};

jest.mock('../../components/ProjectModals', () => ({
  __esModule: true,
  /**
   * Minimal ProjectModals stand-in that drives modal state and active-project state through the
   * same `useWebViewState` hook the real component uses, so tests can assert on state transitions
   * without mounting the full modal tree.
   *
   * @param modal - Current modal identifier controlling which stub panel is rendered.
   * @param setModal - Callback to transition to a different modal state.
   * @param activeProject - The currently active interlinear project, or undefined when none is
   *   selected.
   * @param useWebViewState - Injected hook used to read and write persisted WebView state; must
   *   support the `'activeProject'` key.
   * @returns A JSX element containing the stub modal panels keyed by `modal`.
   */
  default: function StubProjectModals({
    modal,
    setModal,
    activeProject,
    useWebViewState,
  }: {
    modal: string;
    setModal: (m: string) => void;
    activeProject: MockProject | undefined;
    useWebViewState: (
      key: string,
      def: MockProject | undefined,
    ) => [MockProject | undefined, (v: MockProject | undefined) => void, () => void];
    projectId: string;
  }) {
    const [, setActiveProject] = useWebViewState('activeProject', undefined);
    return (
      <div data-testid="project-modals" data-modal={modal}>
        {modal === 'select' && (
          <div data-testid="select-modal">
            <button
              type="button"
              data-testid="select-modal-select"
              onClick={() => {
                setActiveProject(STUB_ACTIVE_PROJECT);
                setModal('none');
              }}
            >
              Select
            </button>
            <button
              type="button"
              data-testid="select-modal-create-new"
              onClick={() => setModal('create')}
            >
              Create new
            </button>
            <button type="button" data-testid="select-modal-close" onClick={() => setModal('none')}>
              Close
            </button>
            <button
              type="button"
              data-testid="select-modal-view-info"
              onClick={() => setModal('metadata')}
            >
              View info
            </button>
          </div>
        )}
        {modal === 'create' && (
          <div data-testid="create-modal">
            <button type="button" data-testid="create-modal-close" onClick={() => setModal('none')}>
              Close
            </button>
            <button
              type="button"
              data-testid="create-modal-created"
              onClick={() => {
                setActiveProject(STUB_ACTIVE_PROJECT);
                setModal('none');
              }}
            >
              Created
            </button>
          </div>
        )}
        {modal === 'metadata' && activeProject && (
          <div data-testid="metadata-modal">
            <button
              type="button"
              data-testid="metadata-modal-close"
              onClick={() => setModal('none')}
            >
              Close
            </button>
            <button
              type="button"
              data-testid="metadata-modal-saved"
              onClick={() => setModal('none')}
            >
              Save
            </button>
            <button
              type="button"
              data-testid="metadata-modal-deleted"
              onClick={() => {
                setActiveProject(undefined);
                setModal('none');
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    );
  },
}));

const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** Pre-built Book with one GEN 1:1 segment. */
const GEN_1_1_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          ref: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
      ],
    },
  ],
};

/** Returns a `useWebViewScrollGroupScrRef` hook stub fixed to GEN 1:1. */
function makeScrollGroupHook() {
  return (): [
    SerializedVerseRef,
    (r: SerializedVerseRef) => void,
    number | undefined,
    (id: number | undefined) => void,
  ] => [defaultScrRef, () => {}, undefined, () => {}];
}

/**
 * Configures useInterlinearizerBookData to return the given state.
 *
 * @param overrides - Partial hook result; all fields default to a successful loaded state
 */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    chapterSegments: Book['segments'];
    isLoading: boolean;
    bookError: string | undefined;
    tokenizeError: { message: string; raw: unknown } | undefined;
  }> = {},
): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: GEN_1_1_BOOK,
    chapterSegments: [],
    isLoading: false,
    bookError: undefined,
    tokenizeError: undefined,
    ...overrides,
  });
}

/**
 * Configures useOptimisticBooleanSetting to return the given state.
 *
 * @param value - The current boolean value; defaults to `false`
 * @param onChange - The change handler; defaults to a jest.fn()
 * @param isLoading - Whether the setting is loading; defaults to `false`
 */
function mockOptimisticSetting(
  value = false,
  onChange: jest.Mock = jest.fn(),
  isLoading = false,
): jest.Mock {
  jest.mocked(useOptimisticBooleanSetting).mockReturnValue({ value, onChange, isLoading });
  return onChange;
}

/**
 * Configures `useSetting` to return per-key values for the two settings consumed by
 * `InterlinearizerLoader`: `platform.interfaceMode` and `platform.interfaceLanguage`.
 *
 * @param interfaceMode - Value for `platform.interfaceMode`; defaults to `'simple'`.
 * @param interfaceLanguage - Value for `platform.interfaceLanguage`; defaults to `[]`.
 */
function mockSettings(
  interfaceMode: 'simple' | 'power' = 'simple',
  interfaceLanguage: string[] = [],
): void {
  jest.mocked(useSetting).mockImplementation((key: string) => {
    if (key === 'platform.interfaceMode') return [interfaceMode, jest.fn(), jest.fn(), false];
    if (key === 'platform.interfaceLanguage')
      return [interfaceLanguage, jest.fn(), jest.fn(), false];
    throw new Error(`useSetting mock: unexpected key "${key}"`);
  });
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    capturedInterlinearizerProps = undefined;
    mockBookData();
    mockOptimisticSetting();
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    mockSettings();
  });

  it('shows nav controls when interface mode is power', () => {
    mockSettings('power');
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('scripture-nav-controls')).toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('hides nav controls when interface mode is simple', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('shows Loading when book data has not arrived', () => {
    mockBookData({ book: undefined, isLoading: true });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error heading and message when bookError is set', () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when tokenization throws an Error', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'parse failure', raw: new Error('parse failure') },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'unexpected string error', raw: 'unexpected string error' },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('passes checked and disabled from useOptimisticBooleanSetting to ContinuousScrollToggle', () => {
    mockOptimisticSetting(true, jest.fn(), true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    const toggle = screen.getByTestId('continuous-scroll-toggle');
    expect(toggle).toHaveAttribute('data-checked', 'true');
    expect(toggle).toHaveAttribute('data-disabled', 'true');
  });

  it('wires ContinuousScrollToggle onCheckedChange to the onChange from useOptimisticBooleanSetting', async () => {
    const mockOnChange = jest.fn();
    mockOptimisticSetting(false, mockOnChange);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));
    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  it('passes continuousScroll=true to Interlinearizer when the setting is true', () => {
    mockOptimisticSetting(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(true);
  });

  it('passes continuousScroll=false to Interlinearizer when the setting is false', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(false);
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('passes the first interfaceLanguage tag to Interlinearizer as analysisLanguage', () => {
    mockSettings('simple', ['fr', 'en']);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('fr');
  });

  it('passes "und" to Interlinearizer as analysisLanguage when interfaceLanguage is empty', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('und');
  });

  describe('modal interactions', () => {
    it('opens the select modal when the project menu selectProject item is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('opens the create modal directly when the openNewProjectModal menu item is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the create modal without showing another when close is clicked from menu source', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await userEvent.click(screen.getByTestId('create-modal-close'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the select modal when its close button is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-close'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('opens the create modal from the select modal create-new button', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('closes all modals after a project is created from the select modal', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-created'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('sets the active project and closes the select modal when a project is selected', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
      // After selection the view-project-info button becomes available, confirming activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('opens the metadata modal from the openProjectInfoModal menu item when a project is active', async () => {
      const state = makeWebViewState();
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={state}
        />,
      );

      // First create a project to set activeProject
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('does not open the metadata modal from openProjectInfoModal when no project is active', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none when metadata is closed after being opened from the menu', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-close'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none and clears active project when the active project is deleted from the menu', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-deleted'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('updates the active project name when its metadata is saved', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-saved'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('renders without error when useData provides a topMenu with items', () => {
      const mockWebViewMenu = {
        topMenu: {
          label: 'top',
          items: [
            {
              command: 'interlinearizer.openProjectInfoModal',
              label: 'View',
              group: 'g',
              order: 1,
              localizeNotes: '',
            },
            {
              command: 'interlinearizer.openSelectProjectModal',
              label: 'Select',
              group: 'g',
              order: 2,
              localizeNotes: '',
            },
          ],
        },
        includeDefaults: true,
        contextMenu: undefined,
      };
      jest
        .mocked(useData)
        .mockReturnValue(
          new Proxy(
            {},
            { get: () => jest.fn().mockReturnValue([mockWebViewMenu, jest.fn(), false]) },
          ),
        );
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });
  });
});
