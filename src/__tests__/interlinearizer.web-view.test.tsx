/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { fireEvent, render, screen } from '@testing-library/react';
import type { InterlinearData } from 'paratext-9-types';

/** Stub InterlinearData returned by the mocked parser. Matches shape the WebView displays. */
const stubInterlinearData: InterlinearData = {
  glossLanguage: 'en',
  bookId: 'MAT',
  verses: {},
};

/** Stub Interlinearization returned by the mocked converter. Matches shape the WebView displays. */
const stubInterlinearization = {
  id: 'mock-interlinear-id',
  sourceWritingSystem: '',
  analysisLanguages: ['en'],
  books: [{ id: 'mock-book-id', bookRef: 'MAT', textVersion: '', segments: [] }],
};

const mockParse = jest.fn().mockReturnValue(stubInterlinearData);
const mockConvert = jest.fn().mockReturnValue(stubInterlinearization);

/** Stub analyses map for Analyses view (ID → Analysis). */
const stubAnalysesMap = new Map([
  [
    'analysis-en-lex1-s1',
    {
      id: 'analysis-en-lex1-s1',
      analysisLanguage: 'en',
      analysisType: 'gloss',
      confidence: 'medium',
      sourceSystem: 'paratext-9',
      sourceUser: 'paratext-9-parser',
      glossText: 'sense1',
    },
  ],
]);
const mockCreateAnalyses = jest.fn().mockReturnValue(stubAnalysesMap);

/** Mock parser: no real XML parsing; returns stub data. Parser/converter are tested elsewhere. */
jest.mock('parsers/paratext-9/paratext9Parser', () => ({
  Paratext9Parser: jest.fn().mockImplementation(() => ({
    parse: mockParse,
  })),
}));

/** Mock converter: no real conversion; returns stub Interlinearization and stub analyses map. */
jest.mock('parsers/paratext-9/paratext9Converter', () => ({
  convertParatext9ToInterlinearization: mockConvert,
  createAnalyses: mockCreateAnalyses,
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

  it('renders the JSON view mode switch (InterlinearData / Interlinearization / Analyses)', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /json view mode/i });
    expect(radiogroup).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^interlineardata$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^interlinearization$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^analyses$/i })).toBeInTheDocument();
    expect(screen.getByText(/view json as:/i)).toBeInTheDocument();
  });

  it('displays InterlinearData JSON by default when parser returns data', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
    expect(screen.getByText(/glossLanguage/i)).toBeInTheDocument();
    expect(screen.getByText(/bookId/i)).toBeInTheDocument();
  });

  it('displays parsed structure including glossLanguage and bookId values', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByText(/"en"/)).toBeInTheDocument();
    expect(screen.getByText(/"MAT"/)).toBeInTheDocument();
  });

  it('does not show parse error when parser succeeds', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.queryByText(/^parse error$/i)).not.toBeInTheDocument();
  });

  it('displays parse error when parser throws an Error (uses err.message)', () => {
    mockParse.mockImplementationOnce(() => {
      throw new Error('Invalid XML structure');
    });

    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid xml structure/i)).toBeInTheDocument();
  });

  it('switching to Interlinearization shows converted model JSON', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));

    expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();
    expect(screen.getByText(/analysisLanguages/i)).toBeInTheDocument();
    expect(screen.getByText(/sourceWritingSystem/i)).toBeInTheDocument();
    expect(screen.getByText(/segments/i)).toBeInTheDocument();
  });

  it('switching back to InterlinearData shows PT9 structure JSON', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));
    expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /^interlineardata$/i }));

    expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
    expect(screen.getByText(/glossLanguage/i)).toBeInTheDocument();
    expect(screen.getByText(/bookId/i)).toBeInTheDocument();
  });

  it('switching to Analyses shows analysis map JSON from test data', () => {
    render(<InterlinearizerWebView {...testWebViewProps} />);

    fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));

    expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();
    expect(mockCreateAnalyses).toHaveBeenCalledWith(stubInterlinearData);
    expect(screen.getByText(/analysis-en-lex1-s1/)).toBeInTheDocument();
    expect(screen.getByText(/glossText/i)).toBeInTheDocument();
    expect(screen.getByText(/paratext-9/i)).toBeInTheDocument();
  });

  it('renders empty JSON pre when jsonToShow is undefined (converter returns undefined)', () => {
    mockConvert.mockReturnValueOnce(undefined);

    const { container } = render(<InterlinearizerWebView {...testWebViewProps} />);
    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));

    const jsonPre = container.querySelector('pre');
    expect(jsonPre).toBeInTheDocument();
    expect(jsonPre).toBeEmptyDOMElement();
    expect(jsonPre).not.toHaveTextContent('undefined');
  });

  it('displays parse error when parser throws non-Error (uses String(err))', () => {
    mockParse.mockImplementationOnce(() => {
      // Intentionally throw a non-Error to test the String(err) branch in the catch block.
      // eslint-disable-next-line no-throw-literal -- testing non-Error handling
      throw 'plain string error';
    });

    render(<InterlinearizerWebView {...testWebViewProps} />);

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText('plain string error')).toBeInTheDocument();
  });
});
