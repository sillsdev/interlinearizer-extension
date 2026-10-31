/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import { defaultScrRef, type ScrollGroupTuple } from './test-helpers';

jest.mock('../components/DuplicateTabNotice', () => ({
  __esModule: true,
  default: ({ webViewId }: { webViewId: string }) => (
    <div data-testid="duplicate-tab-notice">Duplicate {webViewId}</div>
  ),
}));

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

/**
 * A `useWebViewState` that serves the values in `state`, and the caller's default for every other
 * key.
 */
function stateHook(state: Record<string, unknown>) {
  function useState<T>(key: string, defaultValue: T): [T, (v: T) => void, () => void];
  function useState(key: string, defaultValue: unknown): [unknown, () => void, () => void] {
    return [key in state ? state[key] : defaultValue, () => {}, () => {}];
  }
  return useState;
}

/** Builds a minimal WebViewProps for tests. */
function makeProps(
  projectId?: string,
  scrRef: SerializedVerseRef = defaultScrRef,
  state: Record<string, unknown> = {},
): WebViewProps {
  return {
    id: 'test-id',
    webViewType: 'interlinearizer.mainWebView',
    projectId,
    useWebViewState: stateHook(state),
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

  it('shows a duplicate tab the notice pointing at the tab holding its project', () => {
    render(
      <InterlinearizerWebView
        {...makeProps('test-project-id', defaultScrRef, { duplicateOf: 'tab-a' })}
      />,
    );

    expect(screen.getByTestId('duplicate-tab-notice')).toHaveTextContent('Duplicate test-id');
    expect(screen.queryByTestId('interlinearizer-loader')).not.toBeInTheDocument();
  });

  it('renders InterlinearizerLoader when a projectId is provided', () => {
    render(<InterlinearizerWebView {...makeProps('test-project-id')} />);

    expect(screen.getByTestId('interlinearizer-loader')).toBeInTheDocument();
  });
});
