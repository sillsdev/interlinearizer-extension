/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useData,
  useLocalizedStrings,
  useProjectData,
  useProjectSetting,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import { logger } from '@papi/frontend';
import type { Book, InterlinearProject } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';

jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');
jest.mock('../components/CreateProjectModal', () => ({
  CreateProjectModal: ({
    onClose,
    onProjectCreated,
  }: {
    onClose: () => void;
    onProjectCreated?: (id: string, ws: string) => void;
  }) => (
    <div>
      <h2>Create Interlinear Project</h2>
      <button type="button" onClick={() => onProjectCreated?.('new-il-id', 'en')}>
        Submit
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  ),
}));

jest.mock('../components/ProjectMetadataModal', () => ({
  ProjectMetadataModal: ({
    onClose,
    onProjectSaved,
    onProjectDeleted,
    interlinearProjectId,
  }: {
    onClose: () => void;
    onProjectSaved?: (updated: {
      name?: string;
      description?: string;
      analysisWritingSystem: string;
    }) => void;
    onProjectDeleted?: (id: string) => void;
    interlinearProjectId: string;
  }) => (
    <div>
      <h2>Project Info</h2>
      <span data-testid="metadata-project-id">{interlinearProjectId}</span>
      <button type="button" onClick={() => onProjectSaved?.({ analysisWritingSystem: 'fr' })}>
        Save
      </button>
      <button type="button" onClick={() => onProjectDeleted?.(interlinearProjectId)}>
        Delete
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

jest.mock('../components/SelectInterlinearProjectModal', () => ({
  SelectInterlinearProjectModal: ({
    onCreateNew,
    onClose,
    onSelect,
    onViewInfo,
  }: {
    onCreateNew: () => void;
    onClose: () => void;
    onSelect?: (project: {
      id: string;
      createdAt: string;
      sourceProjectId: string;
      analysisWritingSystem: string;
    }) => void;
    onViewInfo?: (project: {
      id: string;
      createdAt: string;
      sourceProjectId: string;
      analysisWritingSystem: string;
    }) => void;
  }) => (
    <div>
      <h2>Select Interlinear Project</h2>
      <button type="button" onClick={onCreateNew}>
        Create New
      </button>
      <button
        type="button"
        data-testid="select-modal-select-project"
        onClick={() =>
          onSelect?.({
            id: 'selected-proj-id',
            createdAt: '2026-01-01T00:00:00.000Z',
            sourceProjectId: 'src',
            analysisWritingSystem: 'en',
          })
        }
      >
        Select Project
      </button>
      <button
        type="button"
        data-testid="select-modal-view-info"
        onClick={() =>
          onViewInfo?.({
            id: 'modal-proj-id',
            createdAt: '2026-01-01T00:00:00.000Z',
            sourceProjectId: 'src',
            analysisWritingSystem: 'en',
          })
        }
      >
        View Info
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  ),
}));

/**
 * Matches the PlatformError shape from platform-bible-utils (discriminated by
 * platformErrorVersion).
 */
type PlatformError = { platformErrorVersion: number; message: string };

/**
 * Load the WebView module; it assigns the component to globalThis.webViewComponent. This pattern is
 * required by the Platform.Bible WebView framework: the WebView entry is built with a ?inline query
 * and consumed by main.ts, so the component is not a normal export. Tests that need to render the
 * component must require() the module and read globalThis. If the WebView export mechanism changes,
 * update this test accordingly.
 */
require('../interlinearizer.web-view');

const InterlinearizerWebView = globalThis.webViewComponent;
if (!InterlinearizerWebView) throw new Error('webViewComponent not loaded');

/** Minimal SerializedVerseRef for hook mock return. */
const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

const testProjectId = 'test-project-id';

/** Pre-built Book with one GEN 1:1 segment — used by tests that need the strip to render. */
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

/** Pre-built Book with no segments — used by the no-verse-data test. */
const GEN_EMPTY_BOOK: Book = { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments: [] };

/** Book with two segments in GEN 1 — used by chapter-display tests. */
const GEN_1_MULTI_BOOK: Book = {
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
    {
      id: 'GEN 1:2',
      startRef: { book: 'GEN', chapter: 1, verse: 2 },
      endRef: { book: 'GEN', chapter: 1, verse: 2 },
      baselineText: 'And the earth.',
      tokens: [
        {
          id: 'GEN 1:2:0',
          surfaceText: 'And',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 3,
        },
      ],
    },
  ],
};

/** Book with a non-word (punctuation) token — exercises the non-word chip branch. */
const GEN_1_1_PUNCTUATION_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: '.',
      tokens: [
        {
          id: 'GEN 1:1:0',
          surfaceText: '.',
          writingSystem: 'en',
          type: 'punctuation',
          charStart: 0,
          charEnd: 1,
        },
      ],
    },
  ],
};

/** The subset of InterlinearProject fields stored as WebView state. */
type ActiveProjectState = Pick<
  InterlinearProject,
  'id' | 'createdAt' | 'sourceProjectId' | 'analysisWritingSystem'
>;

/** Default `useWebViewState` stub — returns `defaultValue` unchanged for every key. */
const defaultUseWebViewState: WebViewProps['useWebViewState'] = <T,>(
  _key: string,
  defaultValue: T,
): [T, (v: T) => void, () => void] => [defaultValue, () => {}, () => {}];

/**
 * Builds a `useWebViewState` that returns the given project for the `'activeProject'` key and
 * `defaultValue` for every other key. Avoids type casts by overloading on key equality.
 *
 * @param project - The active project snapshot to inject into WebView state.
 * @returns A `useWebViewState` implementation suitable for passing to {@link makeProps}.
 */
function makeActiveProjectState(project: ActiveProjectState): WebViewProps['useWebViewState'] {
  function useWebViewState(
    key: 'activeProject',
    defaultValue: ActiveProjectState | undefined,
  ): [ActiveProjectState | undefined, (v: ActiveProjectState | undefined) => void, () => void];
  function useWebViewState<T>(key: string, defaultValue: T): [T, (v: T) => void, () => void];
  function useWebViewState<T>(
    key: string,
    defaultValue: T,
  ): [T | ActiveProjectState | undefined, (v: T) => void, () => void] {
    if (key === 'activeProject') return [project, () => {}, () => {}];
    return [defaultValue, () => {}, () => {}];
  }
  return useWebViewState;
}

/** Builds a minimal WebViewProps for tests. */
function makeProps(
  projectId?: string,
  scrRef: SerializedVerseRef = defaultScrRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
  useWebViewState: WebViewProps['useWebViewState'] = defaultUseWebViewState,
): WebViewProps {
  return {
    id: 'test-id',
    webViewType: 'interlinearizer.mainWebView',
    projectId,
    useWebViewState,
    useWebViewScrollGroupScrRef: (): [
      SerializedVerseRef,
      (r: SerializedVerseRef) => void,
      number | undefined,
      (id: number | undefined) => void,
    ] => [scrRef, setScrRef, undefined, () => {}],
    updateWebViewDefinition: () => true,
  };
}

/** Configures useProjectData to return the given BookUSJ value and loading state this render. */
function mockBookData(value: unknown, isLoading = false): void {
  jest.mocked(useProjectData).mockImplementation(() => ({
    BookUSJ: () => [value, jest.fn(), isLoading],
  }));
}

/** Configures useProjectSetting to return the given writing system tag. */
function mockWritingSystem(tag: string | PlatformError = 'en'): void {
  jest.mocked(useProjectSetting).mockReturnValue([tag, jest.fn(), jest.fn(), false]);
}

describe('InterlinearizerWebView', () => {
  beforeEach(() => {
    mockBookData(undefined);
    mockWritingSystem();
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: jest.fn(),
    });
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(extractBookFromUsj).mockReturnValue({
      bookCode: 'GEN',
      writingSystem: 'en',
      contentHash: 'abc',
      verses: [],
    });
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_1_BOOK);
  });

  it('shows the book chapter control regardless of whether a project is linked', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
  });

  it('shows a prompt to open from a project when no projectId is provided', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByText(/open this webview from a paratext project/i)).toBeInTheDocument();
  });

  it('shows the book chapter control and renders a segment when a project is linked', () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('shows Loading when projectId is set but book data has not arrived', () => {
    mockBookData(undefined, true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error when no USJ book is available for the project', () => {
    mockBookData(undefined, false);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/no usj book available for gen in project/i)).toBeInTheDocument();
  });

  it('renders token chips when the tokenized book has a segment for the current reference', () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('shows a no-verse message when the tokenized book has no segments at all', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_EMPTY_BOOK);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText(/no verse data for gen 1\./i)).toBeInTheDocument();
  });

  it('renders all segments in the current chapter', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('And')).toBeInTheDocument();
  });

  it('highlights only the segment matching the current verse', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    // defaultScrRef is GEN 1:1, so verse 1 is active
    const { container } = render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    const activeSegments = container.querySelectorAll('button[aria-current="true"]');
    expect(activeSegments).toHaveLength(1);
  });

  it('shows all chapter segments when navigating to a title reference (verse 0)', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    render(<InterlinearizerWebView {...makeProps(testProjectId, titleRef)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('And')).toBeInTheDocument();
  });

  it('shows an error heading and message when book data is a PlatformError', () => {
    mockBookData({ platformErrorVersion: 1, message: 'Project not found' });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('falls back to "und" writing system when useProjectSetting returns a PlatformError', () => {
    mockBookData({});
    mockWritingSystem({ platformErrorVersion: 1, message: 'Setting unavailable' });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(extractBookFromUsj).toHaveBeenCalledWith(expect.anything(), 'und');
  });

  it('falls back to "und" writing system when useProjectSetting returns an empty string', () => {
    mockBookData({});
    mockWritingSystem('');
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(extractBookFromUsj).toHaveBeenCalledWith(expect.anything(), 'und');
  });

  it('shows an error heading and message when tokenization throws an Error', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('parse failure');
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'unexpected string error';
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('renders non-word tokens as muted chips', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_1_PUNCTUATION_BOOK);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('calls setScrRef and addRecentScriptureRef with the submitted ref when the verse picker submits', async () => {
    mockBookData({});
    const mockSetScrRef = jest.fn();
    const mockAddRecentRef = jest.fn();
    const targetRef: SerializedVerseRef = { book: 'GEN', chapterNum: 3, verseNum: 7 };
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: mockAddRecentRef,
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId, targetRef, mockSetScrRef)} />);

    await userEvent.click(screen.getByRole('button', { name: /submit reference/i }));

    expect(mockSetScrRef).toHaveBeenCalledWith(targetRef);
    expect(mockAddRecentRef).toHaveBeenCalledWith(targetRef);
  });

  it('calls setScrRef with the segment ref when a verse box is clicked', async () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    const mockSetScrRef = jest.fn();
    // Start at verse 1; click verse 2's token to select it
    render(<InterlinearizerWebView {...makeProps(testProjectId, defaultScrRef, mockSetScrRef)} />);

    await userEvent.click(screen.getByText('And'));

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('logs with "und" writing system when tokenization fails and writing system is a PlatformError', () => {
    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockBookData({});
    mockWritingSystem({ platformErrorVersion: 1, message: 'Setting unavailable' });
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('parse failure');
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ writingSystem: 'und' }),
    );
  });

  it('logs with "und" writing system when tokenization fails and writing system is an empty string', () => {
    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockBookData({});
    mockWritingSystem('');
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('parse failure');
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ writingSystem: 'und' }),
    );
  });

  it('closes the select modal when a project is selected', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    await userEvent.click(screen.getByTestId('select-modal-select-project'));

    expect(
      screen.queryByRole('heading', { name: /select interlinear project/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the create modal open after onProjectCreated fires (modal is dismissed via onClose, not onProjectCreated)', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    expect(
      screen.getByRole('heading', { name: /create interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('does not open the project-info modal when viewProjectInfo is triggered with no active project', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('filters viewProjectInfo out of the menu when no active project is set and topMenu items is an array', async () => {
    const menuWithArrayItems = {
      topMenu: {
        groups: {},
        items: [
          {
            label: 'Select',
            command: 'interlinearizer.createProject',
            group: 'g',
            order: 1,
            localizeNotes: '',
          },
          {
            label: 'View Info',
            command: 'interlinearizer.viewProjectInfo',
            group: 'g',
            order: 3,
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
          { get: () => jest.fn().mockReturnValue([menuWithArrayItems, jest.fn(), false]) },
        ),
      );
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('switches from select modal to create modal when Create New is clicked', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^create new$/i }));

    expect(
      screen.queryByRole('heading', { name: /select interlinear project/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /create interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('closes the select modal when Cancel is clicked', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(
      screen.queryByRole('heading', { name: /select interlinear project/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the select-project modal when the project menu is clicked and a projectId is set', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));

    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('does not show the create-project modal when no projectId is set and new-project is clicked', async () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));

    expect(screen.queryByText('Create Interlinear Project')).not.toBeInTheDocument();
  });

  it('shows the create-project modal when new-project is clicked and a projectId is set', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));

    expect(
      screen.getByRole('heading', { name: /create interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('uses valid menu data from useData when it is not a PlatformError', () => {
    const validMenu = {
      topMenu: { groups: {}, items: {} },
      includeDefaults: true,
      contextMenu: undefined,
    };
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([validMenu, jest.fn(), false]) }),
      );
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
  });

  it('does not throw when the view info menu item is selected', async () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-view-info-menu'));
  });

  it('closes the create-project modal when onClose is called', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
    expect(
      screen.getByRole('heading', { name: /create interlinear project/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(
      screen.queryByRole('heading', { name: /create interlinear project/i }),
    ).not.toBeInTheDocument();
  });

  it('does not show the project-info modal when there is no active project', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    // useWebViewState mock returns undefined for activeProject — modal must stay hidden
    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('shows the project-info modal when viewProjectInfo is triggered and an active project is in state', async () => {
    mockBookData({});
    const activeProject = {
      id: 'il-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: testProjectId,
      analysisWritingSystem: 'en',
    };
    render(
      <InterlinearizerWebView
        {...makeProps(
          testProjectId,
          defaultScrRef,
          undefined,
          makeActiveProjectState(activeProject),
        )}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();
  });

  it('closes the project-info modal when Close is clicked', async () => {
    mockBookData({});
    const activeProject = {
      id: 'il-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: testProjectId,
      analysisWritingSystem: 'en',
    };
    render(
      <InterlinearizerWebView
        {...makeProps(
          testProjectId,
          defaultScrRef,
          undefined,
          makeActiveProjectState(activeProject),
        )}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('opens the metadata modal when the info icon is clicked in the select modal', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('select-modal-view-info'));

    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /select interlinear project/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the correct project ID in the metadata modal when opened via info icon', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    await userEvent.click(screen.getByTestId('select-modal-view-info'));

    expect(screen.getByTestId('metadata-project-id')).toHaveTextContent('modal-proj-id');
  });

  it('returns to the select modal when Close is clicked on metadata opened via info icon', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    await userEvent.click(screen.getByTestId('select-modal-view-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('returns to the select modal when Save is clicked on metadata opened via info icon', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    await userEvent.click(screen.getByTestId('select-modal-view-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('returns to the select modal when Delete is clicked on metadata opened via info icon', async () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
    await userEvent.click(screen.getByTestId('select-modal-view-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /select interlinear project/i }),
    ).toBeInTheDocument();
  });

  it('closes the metadata modal when onProjectSaved is called', async () => {
    mockBookData({});
    const activeProject = {
      id: 'il-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: testProjectId,
      analysisWritingSystem: 'en',
    };
    render(
      <InterlinearizerWebView
        {...makeProps(
          testProjectId,
          defaultScrRef,
          undefined,
          makeActiveProjectState(activeProject),
        )}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('closes the metadata modal when onProjectDeleted is called', async () => {
    mockBookData({});
    const activeProject = {
      id: 'il-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: testProjectId,
      analysisWritingSystem: 'en',
    };
    render(
      <InterlinearizerWebView
        {...makeProps(
          testProjectId,
          defaultScrRef,
          undefined,
          makeActiveProjectState(activeProject),
        )}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
    expect(screen.getByRole('heading', { name: /project info/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.queryByRole('heading', { name: /project info/i })).not.toBeInTheDocument();
  });

  it('passes a stable object reference to BookUSJ so chapter and verse changes do not re-fetch the book', () => {
    const mockBookUSJ = jest.fn().mockReturnValue([{}, jest.fn(), false]);
    jest.mocked(useProjectData).mockImplementation(() => ({ BookUSJ: mockBookUSJ }));
    const { rerender } = render(<InterlinearizerWebView {...makeProps(testProjectId)} />);
    rerender(
      <InterlinearizerWebView
        {...makeProps(testProjectId, { book: 'GEN', chapterNum: 2, verseNum: 5 })}
      />,
    );

    expect(mockBookUSJ.mock.calls.length).toBeGreaterThanOrEqual(2);
    const refsPassed = mockBookUSJ.mock.calls.map((c) => c[0]);
    // All calls must receive the exact same object reference (memo identity), not just equal values.
    // If the memo were broken, each render would create a new object and this would fail.
    refsPassed.slice(1).forEach((ref) => expect(ref).toBe(refsPassed[0]));
    expect(refsPassed[0]).toEqual({ book: 'GEN', chapterNum: 1, verseNum: 1 });
  });
});
