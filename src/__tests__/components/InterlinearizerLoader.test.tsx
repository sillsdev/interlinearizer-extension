/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useData, useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';

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

jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useOptimisticBooleanSetting');

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

jest.mock('../../components/Interlinearizer', () => ({
  __esModule: true,
  default: () => <div data-testid="interlinearizer" />,
}));

jest.mock('../../components/ContinuousScrollToggle', () => ({
  __esModule: true,
  default: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean;
    disabled: boolean;
    label: string;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      data-testid="continuous-scroll-toggle"
      checked={checked}
      disabled={disabled}
      onChange={(e) => {
        if (!disabled) onCheckedChange(e.target.checked);
      }}
    />
  ),
}));

jest.mock('../../components/ScriptureNavControls', () => ({
  __esModule: true,
  default: () => <div data-testid="scripture-nav-controls" />,
}));

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

/**
 * Returns a `useWebViewScrollGroupScrRef` hook stub bound to the given reference and setter.
 *
 * @param scrRef - Scripture reference to expose; defaults to GEN 1:1
 * @param setScrRef - Setter callback; defaults to a no-op
 */
function makeScrollGroupHook(
  scrRef: SerializedVerseRef = defaultScrRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
) {
  return (): [
    SerializedVerseRef,
    (r: SerializedVerseRef) => void,
    number | undefined,
    (id: number | undefined) => void,
  ] => [scrRef, setScrRef, undefined, () => {}];
}

/** Typed read/write pair stored per key in {@link makeWebViewState}. */
type StateSlot<T> = { get: () => T; set: (v: T) => void };

/**
 * Returns a `useWebViewState` hook stub that stores values in typed per-key closures so state
 * persists across re-renders within the same test without requiring any type assertions.
 */
function makeWebViewState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = new Map<string, StateSlot<any>>();
  return <T,>(key: string, defaultValue: T): [T, (v: T) => void, () => void] => {
    let slot: StateSlot<T> | undefined = slots.get(key);
    if (slot === undefined) {
      let stored = defaultValue;
      slot = {
        get: () => stored,
        set: (v) => {
          stored = v;
        },
      };
      slots.set(key, slot);
    }
    const resolvedSlot = slot;
    return [
      resolvedSlot.get(),
      (v: T) => resolvedSlot.set(v),
      () => {
        slots.delete(key);
      },
    ];
  };
}

/**
 * Configures the useInterlinearizerBookData mock for a single render. Defaults to a successfully
 * loaded book so most tests can call this with no arguments.
 *
 * @param overrides - Partial result fields to override the defaults.
 */
function mockBookHook(
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
    chapterSegments: GEN_1_1_BOOK.segments,
    isLoading: false,
    bookError: undefined,
    tokenizeError: undefined,
    ...overrides,
  });
}

/**
 * Configures the useOptimisticBooleanSetting mock. Defaults to continuousScroll=false, not loading.
 *
 * @param value - Current boolean value of the setting.
 * @param onChange - Change handler; defaults to a no-op jest.fn().
 * @param isLoading - Whether the setting is still loading.
 */
function mockSettingHook(
  value = false,
  onChange: (v: boolean) => void = jest.fn(),
  isLoading = false,
): void {
  jest.mocked(useOptimisticBooleanSetting).mockReturnValue({ value, onChange, isLoading });
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    mockBookHook();
    mockSettingHook();
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: jest.fn(),
    });
  });

  it('shows nav controls and the interlinearizer when book data is available', () => {
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

  it('shows Loading when book data has not arrived', () => {
    mockBookHook({ book: undefined, chapterSegments: [], isLoading: true });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error when the hook reports a book error', () => {
    mockBookHook({
      book: undefined,
      chapterSegments: [],
      bookError: 'No USJ book available for GEN in project test-project-id',
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/no usj book available for gen in project/i)).toBeInTheDocument();
  });

  it('shows a tokenize error when the hook reports one', () => {
    mockBookHook({
      book: undefined,
      chapterSegments: [],
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

  it('renders the continuous scroll toggle', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('continuous scroll toggle is checked when the setting is true', () => {
    mockSettingHook(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('continuous scroll toggle is unchecked when the setting is false', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clicking the continuous scroll toggle calls onChange with the toggled value', async () => {
    const mockOnChange = jest.fn();
    mockSettingHook(true, mockOnChange);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));

    expect(mockOnChange).toHaveBeenCalledWith(false);
  });

  it('renders the interlinearizer stub when the setting is false', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
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

    it('closes the create modal and sets the active project when a project is created', async () => {
      const state = makeWebViewState();
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={state}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-created'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
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

    it('handles topMenu with no items array without throwing', () => {
      jest.mocked(useData).mockReturnValue(
        new Proxy(
          {},
          {
            get: () =>
              jest
                .fn()
                .mockReturnValue([
                  { topMenu: { label: 'top' }, includeDefaults: true, contextMenu: undefined },
                  jest.fn(),
                  false,
                ]),
          },
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
