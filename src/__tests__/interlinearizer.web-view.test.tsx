/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useLocalizedStrings,
  useProjectData,
  useProjectSetting,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';

jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

// Store captured props so tests can simulate callbacks
let capturedContinuousViewProps: Record<string, unknown> = {};

jest.mock('../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedContinuousViewProps = props;
    return <div data-testid="continuous-view" />;
  },
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

/** Builds a minimal WebViewProps for tests. */
function makeProps(
  projectId?: string,
  scrRef: SerializedVerseRef = defaultScrRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
): WebViewProps {
  return {
    id: 'test-id',
    webViewType: 'interlinearizer.mainWebView',
    projectId,
    useWebViewState: <T,>(_key: string, defaultValue: T): [T, (v: T) => void, () => void] => [
      defaultValue,
      () => {},
      () => {},
    ],
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

/**
 * Configures useProjectSetting for the languageTag and continuousScroll keys. All other keys
 * receive their defaultState.
 *
 * @param tag - Writing system tag returned for `platform.languageTag`
 * @param continuousScroll - Value returned for `interlinearizer.continuousScroll`; defaults to
 *   `false` so existing token-chip rendering tests are unaffected
 */
function mockWritingSystem(tag: string | PlatformError = 'en', continuousScroll = false): void {
  jest.mocked(useProjectSetting).mockImplementation((_projectId, key, defaultState) => {
    if (key === 'platform.languageTag') return [tag, jest.fn(), jest.fn(), false];
    if (key === 'interlinearizer.continuousScroll')
      return [continuousScroll, jest.fn(), jest.fn(), false];
    return [defaultState, jest.fn(), jest.fn(), false];
  });
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

  it('calls setScrRef and addRecentScriptureRef when the verse picker submits', async () => {
    mockBookData({});
    const mockSetScrRef = jest.fn();
    const mockAddRecentRef = jest.fn();
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: mockAddRecentRef,
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId, defaultScrRef, mockSetScrRef)} />);

    await userEvent.click(screen.getByRole('button', { name: /submit reference/i }));

    expect(mockSetScrRef).toHaveBeenCalledWith(defaultScrRef);
    expect(mockAddRecentRef).toHaveBeenCalledWith(defaultScrRef);
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

  it('passes a book-stable ref to BookUSJ so chapter and verse changes do not re-fetch the book', () => {
    const mockBookUSJ = jest.fn().mockReturnValue([{}, jest.fn(), false]);
    jest.mocked(useProjectData).mockImplementation(() => ({ BookUSJ: mockBookUSJ }));
    const { rerender } = render(<InterlinearizerWebView {...makeProps(testProjectId)} />);
    rerender(
      <InterlinearizerWebView
        {...makeProps(testProjectId, { book: 'GEN', chapterNum: 2, verseNum: 5 })}
      />,
    );

    const refsPassed = mockBookUSJ.mock.calls.map((c) => c[0]);
    refsPassed.forEach((ref) => expect(ref).toEqual({ book: 'GEN', chapterNum: 1, verseNum: 1 }));
    expect(mockBookUSJ.mock.calls.length).toBeGreaterThanOrEqual(2);
    refsPassed.slice(1).forEach((ref) => expect(ref).toBe(refsPassed[0]));
  });

  it('renders the continuous scroll toggle when a project is linked', () => {
    mockBookData({});
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('does not render the continuous scroll toggle when no project is linked', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('continuous scroll toggle is checked when the setting is true', () => {
    mockBookData({});
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('continuous scroll toggle is unchecked when the setting is false', () => {
    mockBookData({});
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll') return [false, jest.fn(), jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('renders segments in baseline-text mode when continuousScroll is true', () => {
    mockBookData({});
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();
  });

  it('renders all chapter segments in baseline-text mode when continuousScroll is true', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
    expect(screen.getByText('And the earth.')).toBeInTheDocument();
  });

  it('clicking the continuous scroll toggle calls setContinuousScroll with the new value', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [true, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    await userEvent.click(screen.getByRole('checkbox'));

    expect(mockSetContinuousScroll).toHaveBeenCalledWith(false);
  });

  it('switches rendering immediately using optimistic local state while setting saves', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    // Setting source remains true during the test (simulates delayed persistence confirmation).
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [true, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    // Initially in continuous mode.
    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox'));

    // Before setting saves, UI should already switch to token-chip mode.
    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(mockSetContinuousScroll).toHaveBeenCalledWith(false);
  });

  it('renders ContinuousView when continuousScroll is true and book is loaded', () => {
    mockBookData({});
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();
  });

  it('does not render ContinuousView when continuousScroll is false', () => {
    mockBookData({});
    mockWritingSystem('en', false);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
  });

  it('does not render ContinuousView when continuousScroll defaults to true but book is still loading', () => {
    mockBookData(undefined, true);
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
  });

  it('does not render ContinuousView when there is a book error', () => {
    mockBookData({ platformErrorVersion: 1, message: 'Project not found' });
    mockWritingSystem('en', true);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
  });

  it('renders ContinuousView above the chapter segment rows when both are present', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    mockWritingSystem('en', true);
    const { container } = render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    const continuousView = screen.getByTestId('continuous-view');
    // All interactive elements in DOM order; ContinuousView's div must precede the segment buttons
    const allElements = Array.from(
      container.querySelectorAll('[data-testid="continuous-view"], button[aria-current]'),
    );
    expect(allElements[0]).toBe(continuousView);
  });

  it('toggles continuous scroll setting back to true after being false', async () => {
    mockBookData({});
    const mockSetContinuousScroll = jest.fn();
    jest.mocked(useProjectSetting).mockImplementation((_p, key, d) => {
      if (key === 'interlinearizer.continuousScroll')
        return [false, mockSetContinuousScroll, jest.fn(), false];
      if (key === 'platform.languageTag') return ['en', jest.fn(), jest.fn(), false];
      return [d, jest.fn(), jest.fn(), false];
    });

    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    // Initially in token-chip mode
    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();

    // Click toggle to turn on continuous mode
    await userEvent.click(screen.getByRole('checkbox'));
    expect(mockSetContinuousScroll).toHaveBeenCalledWith(true);
  });

  it('calls setScrRef when ContinuousView emits onVerseChange', async () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_MULTI_BOOK);
    mockWritingSystem('en', true);

    const mockSetScrRef = jest.fn();
    render(<InterlinearizerWebView {...makeProps(testProjectId, defaultScrRef, mockSetScrRef)} />);

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();

    // Simulate ContinuousView calling onVerseChange
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-type-assertion/no-type-assertion
    const onVerseChange = capturedContinuousViewProps.onVerseChange as any;
    expect(onVerseChange).toBeDefined();

    onVerseChange({ book: 'GEN', chapter: 2, verse: 3 });

    expect(mockSetScrRef).toHaveBeenCalledWith({
      book: 'GEN',
      chapterNum: 2,
      verseNum: 3,
    });
  });
});
