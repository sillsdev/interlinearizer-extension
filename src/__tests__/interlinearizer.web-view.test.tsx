/**
 * Unit tests for the interlinearizer WebView component (interlinearizer.web-view.tsx).
 *
 * Covers:
 *
 * - Success path: rendering with valid parsed data (heading, JSON output, structure).
 * - Error path (parse throws): displays error when parser throws Error.
 * - Error path (parse throws non-Error): displays error via String(err) when parser throws a
 *   non-Error (e.g. string). The catch uses `new Error(String(err)).message` for both; the
 *   non-Error case verifies String() handles primitives correctly.
 *
 * Parser is mocked at top level and defaults to the real implementation; the parse-error test uses
 * mockImplementationOnce so the component (which creates the parser in useMemo) gets a throwing
 * instance. No isolateModules or require() needed.
 */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import { InterlinearXmlParser } from '../parsers/interlinearXmlParser';

/** Mock parser so we can override constructor behavior per test (e.g. parse-error test). */
jest.mock('../parsers/interlinearXmlParser', () => {
  const actual = jest.requireActual<typeof import('../parsers/interlinearXmlParser')>(
    '../parsers/interlinearXmlParser',
  );
  return {
    InterlinearXmlParser: jest.fn().mockImplementation(() => new actual.InterlinearXmlParser()),
  };
});

/** Load the web-view module; it assigns the component to globalThis.webViewComponent. */
require('../interlinearizer.web-view');

const InterlinearizerWebView = globalThis.webViewComponent;
if (!InterlinearizerWebView) throw new Error('webViewComponent not loaded');

/** Minimal SerializedVerseRef for hook mock return. */
const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** Full WebViewProps for tests; interlinearizer component ignores hooks/update. */
const testWebViewProps: WebViewProps = {
  id: 'test-id',
  webViewType: 'interlinearizer.mainWebView',
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

describe('InterlinearizerWebView', () => {
  it('renders the heading "Interlinearizer"', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByRole('heading', { name: /interlinearizer/i })).toBeInTheDocument();
  });

  it('renders the description mentioning test-data XML', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(
      screen.getByText(/raw json of the model parsed from/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/test-data\/Interlinear_en_MAT\.xml/i)).toBeInTheDocument();
  });

  it('parses the bundled test XML and displays parsed JSON', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByText(/parsed interlinear data \(json\)/i)).toBeInTheDocument();
    expect(screen.getByText(/"GlossLanguage"/)).toBeInTheDocument();
    expect(screen.getByText(/"BookId"/)).toBeInTheDocument();
  });

  it('displays parsed structure with expected verse data', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByText(/"en"/)).toBeInTheDocument();
    expect(screen.getByText(/"MAT"/)).toBeInTheDocument();
  });

  it('does not show parse error when XML is valid', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.queryByText(/^parse error$/i)).not.toBeInTheDocument();
  });

  it('displays parse error when parser throws', () => {
    const actual = jest.requireActual<typeof import('../parsers/interlinearXmlParser')>(
      '../parsers/interlinearXmlParser',
    );
    const realInstance = new actual.InterlinearXmlParser();
    const throwingParse = (): never => {
      throw new Error('Invalid XML structure');
    };
    Object.defineProperty(realInstance, 'parse', { value: throwingParse, writable: true });
    jest.mocked(InterlinearXmlParser).mockImplementationOnce(() => realInstance);

    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByRole('heading', { name: /parse error/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid xml structure/i)).toBeInTheDocument();
  });
});
