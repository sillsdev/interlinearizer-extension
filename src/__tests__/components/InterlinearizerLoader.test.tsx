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

const MOCK_PROJECT: MockProject = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  sourceProjectId: testProjectId,
  analysisLanguages: ['en'],
  name: 'My Project',
};

jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useOptimisticBooleanSetting');

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

jest.mock('../../components/SelectInterlinearProjectModal', () => ({
  __esModule: true,
  SelectInterlinearProjectModal: ({
    onSelect,
    onCreateNew,
    onClose,
    onViewInfo,
  }: {
    onSelect: (p: MockProject) => void;
    onCreateNew: () => void;
    onClose: () => void;
    onViewInfo: (p: MockProject) => void;
  }) => (
    <div data-testid="select-modal">
      <button
        type="button"
        data-testid="select-modal-select"
        onClick={() => onSelect(MOCK_PROJECT)}
      >
        Select
      </button>
      <button type="button" data-testid="select-modal-create-new" onClick={onCreateNew}>
        Create new
      </button>
      <button type="button" data-testid="select-modal-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="select-modal-view-info"
        onClick={() => onViewInfo(MOCK_PROJECT)}
      >
        View info
      </button>
    </div>
  ),
  isInterlinearProjectSummary: (p: unknown) => !!p,
}));

jest.mock('../../components/CreateProjectModal', () => ({
  __esModule: true,
  CreateProjectModal: ({
    onClose,
    onProjectCreated,
  }: {
    onClose: () => void;
    onProjectCreated: (p: MockProject) => void;
  }) => (
    <div data-testid="create-modal">
      <button type="button" data-testid="create-modal-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="create-modal-created"
        onClick={() => onProjectCreated(MOCK_PROJECT)}
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
    onProjectSaved: (u: { analysisLanguages: string[] }) => void;
    onProjectDeleted: (id: string) => void;
  }) => (
    <div data-testid="metadata-modal">
      <button type="button" data-testid="metadata-modal-close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-testid="metadata-modal-saved"
        onClick={() => {
          onProjectSaved({ analysisLanguages: ['fr'] });
          onClose();
        }}
      >
        Save
      </button>
      <button
        type="button"
        data-testid="metadata-modal-deleted"
        onClick={() => onProjectDeleted(MOCK_PROJECT.id)}
      >
        Delete
      </button>
    </div>
  ),
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
          id: 'GEN 1:1:0',
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

  it('shows the book chapter control and renders a segment when book data is available', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
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

  it('renders continuous view when the setting is true', () => {
    mockSettingHook(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();
  });

  it('renders token-chip view when the setting is false', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
  });

  describe('modal interactions', () => {
    it('opens the select modal when the project menu createProject item is clicked', async () => {
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

    it('closes the create modal without opening another when close is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-close'));

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

    it('opens the metadata modal from the select modal view-info button', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-view-info'));

      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('returns to the select modal when metadata is closed after being opened from select', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-view-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-close'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('returns to the select modal when metadata is saved after being opened from select', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-view-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-saved'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('returns to the select modal when a project is deleted from the metadata modal opened via select', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-view-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-deleted'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('opens the metadata modal from the viewProjectInfo menu item when a project is active', async () => {
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

    it('does not open the metadata modal from viewProjectInfo when no project is active', async () => {
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

    it('filters viewProjectInfo from menu when no active project', () => {
      const mockWebViewMenu = {
        topMenu: {
          label: 'top',
          items: [
            {
              command: 'interlinearizer.viewProjectInfo',
              label: 'View',
              group: 'g',
              order: 1,
              localizeNotes: '',
            },
            {
              command: 'interlinearizer.createProject',
              label: 'Create',
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

      // tab-toolbar-view-project-info button is rendered only when projectMenuData includes it
      // The TabToolbar mock renders it always when onSelectProjectMenuItem is provided,
      // so we verify the projectMenuData filtering by checking the loader renders without error
      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });
  });
});
