/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import { useProjectData } from '@papi/frontend/react';

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

/** Builds a minimal WebViewProps for tests. */
function makeProps(projectId?: string): WebViewProps {
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
    ] => [defaultScrRef, () => {}, undefined, () => {}],
    updateWebViewDefinition: () => true,
  };
}

/** Configures useProjectData to return the given BookUSJ value and loading state this render. */
function mockBookData(value: unknown, isLoading = false): void {
  jest.mocked(useProjectData).mockImplementation(() => ({
    BookUSJ: () => [value, jest.fn(), isLoading],
  }));
}

describe('InterlinearizerWebView', () => {
  beforeEach(() => {
    mockBookData(undefined);
  });

  it('renders the heading "Interlinearizer"', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByRole('heading', { name: /interlinearizer/i })).toBeInTheDocument();
  });

  it('shows a prompt to open from a project when no projectId is provided', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByText(/open this webview from a paratext project/i)).toBeInTheDocument();
  });

  it('shows the book and projectId when a project is linked', () => {
    mockBookData({
      type: 'USJ',
      version: '3.1',
      content: [{ type: 'book', marker: 'id', code: 'GEN' }],
    });
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByText(/test-project-id/)).toBeInTheDocument();
    expect(screen.getByText(/GEN · project/)).toBeInTheDocument();
  });

  it('shows Loading when projectId is set but book data has not arrived', () => {
    mockBookData(undefined, true);
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error when no USJ book is available for the project', () => {
    mockBookData(undefined, false);
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(
      screen.getByText(/no usj book available for gen in project test-project-id/i),
    ).toBeInTheDocument();
  });

  it('shows the raw USFM when book data arrives', () => {
    mockBookData({
      type: 'USJ',
      version: '3.1',
      content: [{ type: 'book', marker: 'id', code: 'GEN' }],
    });
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByText(/"code": "GEN"/)).toBeInTheDocument();
  });

  it('shows an error heading and message when book data is a PlatformError', () => {
    mockBookData({ isPlatformError: true, message: 'Project not found' });
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });
});
