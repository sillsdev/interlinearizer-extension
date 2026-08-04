/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import { defaultScrRef, type ScrollGroupTuple } from './test-helpers';

jest.mock('../components/InterlinearizerLoader', () => ({
  __esModule: true,
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="interlinearizer-loader">Loader for {projectId}</div>
  ),
}));

// PAPI WebView contract: the module assigns the component to globalThis.webViewComponent instead of exporting it.
require('../interlinearizer.web-view');

const InterlinearizerWebView = globalThis.webViewComponent;
if (!InterlinearizerWebView) throw new Error('webViewComponent not loaded');

/** Builds a minimal WebViewProps for tests. */
function makeProps(projectId?: string, scrRef: SerializedVerseRef = defaultScrRef): WebViewProps {
  return {
    id: 'test-id',
    webViewType: 'interlinearizer.mainWebView',
    projectId,
    useWebViewState: <T,>(_key: string, defaultValue: T): [T, (v: T) => void, () => void] => [
      defaultValue,
      () => {},
      () => {},
    ],
    useWebViewScrollGroupScrRef: (): ScrollGroupTuple => [
      scrRef,
      () => {},
      undefined,
      () => {},
      undefined,
    ],
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
