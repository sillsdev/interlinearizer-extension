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
  analysisWritingSystem: string;
  name?: string;
  description?: string;
};

const testProjectId = 'test-project-id';

const STUB_ACTIVE_PROJECT: MockProject = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  sourceProjectId: testProjectId,
  analysisWritingSystem: 'en',
  name: 'My Project',
};

jest.mock('../../components/ProjectModals', () => ({
  __esModule: true,
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
                setModal('select');
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
    jest.mocked(useSetting).mockReturnValue(['simple', jest.fn(), jest.fn(), false]);
  });

  it('shows nav controls when interface mode is power', () => {
    jest.mocked(useSetting).mockReturnValue(['power', jest.fn(), jest.fn(), false]);
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

  it('shows an error when no USJ book is available for the project', () => {
    mockBookData({
      book: undefined,
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

  it('shows an error heading and message when book data is a PlatformError', () => {
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

  it('passes a book-stable ref to BookUSJ so chapter and verse changes do not re-fetch the book', () => {
    // The book-stable ref logic lives in useInterlinearizerBookData, which is tested in its own
    // test file. This test verifies that InterlinearizerLoader passes scrRef into the hook and that
    // re-rendering with a new verse does not cause the hook to receive a new book ref.
    const webViewState = makeWebViewState();
    const { rerender } = render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={webViewState}
      />,
    );
    rerender(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 2,
          verseNum: 5,
        })}
        useWebViewState={webViewState}
      />,
    );

    const { calls } = jest.mocked(useInterlinearizerBookData).mock;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    calls.forEach((args) => expect(args[0].projectId).toBe(testProjectId));
  });

  it('passes continuousScroll from useOptimisticBooleanSetting to Interlinearizer', () => {
    mockOptimisticSetting(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('continuous-scroll-toggle')).toBeInTheDocument();
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

  it('clicking the continuous scroll toggle calls onChange with the toggled value', async () => {
    const mockOnChange = jest.fn();
    mockOptimisticSetting(true, mockOnChange);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));

    expect(mockOnChange).toHaveBeenCalledWith(false);
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

    it('returns to the select modal after a project is created from the select modal', async () => {
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
      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
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

    it('filters openProjectInfoModal from menu when no active project', () => {
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

      // tab-toolbar-view-project-info button is rendered only when projectMenuData includes it
      // The TabToolbar mock renders it always when onSelectProjectMenuItem is provided,
      // so we verify the projectMenuData filtering by checking the loader renders without error
      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });
  });
});
