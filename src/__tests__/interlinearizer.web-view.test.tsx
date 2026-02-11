/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import { InterlinearXmlParser } from 'parsers/interlinearXmlParser';

/** Mock parser to allow overriding constructor behavior per test. */
jest.mock('parsers/interlinearXmlParser', () => {
  const actual = jest.requireActual<typeof import('parsers/interlinearXmlParser')>(
    'parsers/interlinearXmlParser',
  );
  return {
    InterlinearXmlParser: jest.fn().mockImplementation(() => new actual.InterlinearXmlParser()),
  };
});

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

  it('displays parse error when parser throws an Error (uses err.message)', () => {
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

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid xml structure/i)).toBeInTheDocument();
  });

  it('displays parse error when parser throws non-Error (uses String(err))', () => {
    const actual = jest.requireActual<typeof import('../parsers/interlinearXmlParser')>(
      '../parsers/interlinearXmlParser',
    );
    const realInstance = new actual.InterlinearXmlParser();
    const throwingParse = (): never => {
      // Intentionally throw a non-Error to test the String(err) branch in the catch block.
      // eslint-disable-next-line no-throw-literal -- testing non-Error handling
      throw 'plain string error';
    };
    Object.defineProperty(realInstance, 'parse', { value: throwingParse, writable: true });
    jest.mocked(InterlinearXmlParser).mockImplementationOnce(() => realInstance);

    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText('plain string error')).toBeInTheDocument();
  });
});
