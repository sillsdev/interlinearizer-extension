/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';

jest.mock('../components/InterlinearizerLoader', () => ({
  __esModule: true,
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="interlinearizer-loader">Loader for {projectId}</div>
  ),
}));

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
function makeProps(projectId?: string, scrRef: SerializedVerseRef = defaultScrRef): WebViewProps {
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
    ] => [scrRef, () => {}, undefined, () => {}],
    updateWebViewDefinition: () => true,
  };
}

describe('InterlinearizerWebView', () => {
  it('shows a prompt to open from a project when no projectId is provided', () => {
    render(<InterlinearizerWebView {...makeProps()} />);

    expect(screen.getByText(/open this webview from a paratext project/i)).toBeInTheDocument();
  });

  it('renders InterlinearizerLoader when a projectId is provided', () => {
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByTestId('interlinearizer-loader')).toBeInTheDocument();
  });
});
