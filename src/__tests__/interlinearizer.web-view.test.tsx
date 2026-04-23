/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  useProjectData,
  useProjectSetting,
  useLocalizedStrings,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';

jest.mock('parsers/papi/usjBookExtractor');
jest.mock('parsers/papi/bookTokenizer');

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
const EMPTY_BOOK: Book = { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments: [] };

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

/** Configures useProjectSetting to return the given writing system tag. */
function mockWritingSystem(
  tag: string | { platformErrorVersion: number; message: string } = 'en',
): void {
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
    jest.mocked(extractBookFromUsj).mockReturnValue({
      bookCode: 'GEN',
      writingSystem: 'en',
      contentHash: 'abc',
      verses: [],
    });
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_1_BOOK);
  });

  it('renders the heading "Interlinearizer"', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByRole('heading', { name: /interlinearizer/i })).toBeInTheDocument();
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
    jest.mocked(tokenizeBook).mockReturnValue(EMPTY_BOOK);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText(/no verse data for gen 1:1/i)).toBeInTheDocument();
  });

  it('falls back to the first segment when the current reference has no exact match (e.g. verse 0)', () => {
    mockBookData({});
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    render(<InterlinearizerWebView {...makeProps(testProjectId, titleRef)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
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
  });

  it('falls back to "und" writing system when useProjectSetting returns an empty string', () => {
    mockBookData({});
    mockWritingSystem('');
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('shows a no-verse message when tokenization throws', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('parse failure');
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText(/no verse data for gen 1:1/i)).toBeInTheDocument();
  });

  it('renders non-word tokens as muted chips', () => {
    mockBookData({});
    jest.mocked(tokenizeBook).mockReturnValue(GEN_1_1_PUNCTUATION_BOOK);
    render(<InterlinearizerWebView {...makeProps(testProjectId)} />);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('calls setScrRef and addRecentScriptureRef when the verse picker submits', () => {
    mockBookData({});
    const mockSetScrRef = jest.fn();
    const mockAddRecentRef = jest.fn();
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: mockAddRecentRef,
    });
    render(<InterlinearizerWebView {...makeProps(testProjectId, defaultScrRef, mockSetScrRef)} />);

    fireEvent.click(screen.getByRole('button', { name: /submit reference/i }));

    expect(mockSetScrRef).toHaveBeenCalledWith(defaultScrRef);
    expect(mockAddRecentRef).toHaveBeenCalledWith(defaultScrRef);
  });
});
