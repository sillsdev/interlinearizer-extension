/** @file Unit tests for interlinearizer.web-view.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { WebViewProps } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as lexiconParser from 'parsers/paratext-9/lexiconParser';
import * as paratext9Parser from 'parsers/paratext-9/interlinearParser';
import * as paratext9Converter from 'parsers/paratext-9/converter';
import type { Analysis, InterlinearAlignment, Interlinearization } from 'interlinearizer';
import { AnalysisType, Confidence } from 'types/interlinearizer-enums';
import * as interlinearizerWebViewModule from '../interlinearizer.web-view';

jest.mock('parsers/paratext-9/interlinearParser');
jest.mock('parsers/paratext-9/converter');
jest.mock('parsers/paratext-9/lexiconParser');

type ParserMock = typeof paratext9Parser & {
  mockParse: jest.Mock;
  stubInterlinearData: import('parsers/paratext-9/types').InterlinearData;
};

/** Uses real converter types so stub properties (e.g. .books) are correctly typed in tests. */
type ConverterMock = typeof paratext9Converter & {
  mockConvertAlignment: jest.Mock;
  mockCreateSourceAnalyses: jest.Mock;
  mockCreateTargetAnalyses: jest.Mock;
  stubAlignment: InterlinearAlignment;
  stubInterlinearization: Interlinearization;
  stubTargetInterlinearization: Interlinearization;
  stubSourceAnalysesMap: Map<string, Analysis>;
  stubTargetAnalysesMap: Map<string, Analysis>;
  stubAnalysesMap: Map<string, Analysis>;
};

function isParserMock(m: typeof paratext9Parser): m is ParserMock {
  return 'mockParse' in m && 'stubInterlinearData' in m;
}
function isConverterMock(m: typeof paratext9Converter): m is ConverterMock {
  return 'mockConvertAlignment' in m && 'stubAlignment' in m;
}

function getParserMock(): ParserMock {
  if (!isParserMock(paratext9Parser)) throw new Error('Expected parser mock');
  return paratext9Parser;
}
function getConverterMock(): ConverterMock {
  if (!isConverterMock(paratext9Converter)) throw new Error('Expected converter mock');
  return paratext9Converter;
}

const { stubInterlinearData, mockParse } = getParserMock();
const {
  stubAlignment,
  stubInterlinearization,
  stubTargetInterlinearization,
  stubTargetAnalysesMap,
  mockConvertAlignment,
  mockCreateSourceAnalyses,
  mockCreateTargetAnalyses,
} = getConverterMock();

/** First book of stub target (for building alignment variants). */
const stubTargetBook = stubTargetInterlinearization.books[0];

/**
 * Load the WebView module; it assigns the component to globalThis.webViewComponent. This pattern is
 * required by the Platform.Bible WebView framework: the WebView entry is built with a ?inline query
 * and consumed by main.ts, so the component is not a normal export. Tests that need to render the
 * component must require() the module and read globalThis. If the WebView export mechanism changes,
 * update this test accordingly.
 */

const InterlinearizerWebView = globalThis.webViewComponent;
const { handleJsonViewModeKeyDown } = interlinearizerWebViewModule;
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

/**
 * Renders the WebView and waits for the mount effect's async conversion to settle inside act(). The
 * component calls convertParatext9ToInterlinearAlignment(parsed, lexiconData) in useEffect; when
 * the promise resolves it calls setAlignment. Without waiting, that update runs after the test and
 * triggers "An update to ... was not wrapped in act(...)". This helper flushes the async work so
 * all state updates are wrapped.
 */
async function renderWebView(): Promise<ReturnType<typeof render>> {
  return act(async () => {
    const result = render(<InterlinearizerWebView {...testWebViewProps} />);
    await Promise.resolve();
    await Promise.resolve();
    return result;
  });
}

describe('InterlinearizerWebView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the heading "Interlinearizer"', async () => {
    await renderWebView();

    expect(screen.getByRole('heading', { name: /interlinearizer/i })).toBeInTheDocument();
  });

  it('renders the description mentioning test-data XML', async () => {
    await renderWebView();

    expect(
      screen.getByText(/raw json of the model parsed from/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/test-data\/Interlinear_en_JHN\.xml/i)).toBeInTheDocument();
  });

  it('renders the view mode switch (Interlinear / InterlinearData / Interlinearization / Analyses)', async () => {
    await renderWebView();

    const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
    expect(radiogroup).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^interlinear$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^interlineardata$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^interlinearization$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^analyses$/i })).toBeInTheDocument();
    expect(screen.getByText(/view json as:/i)).toBeInTheDocument();
  });

  it('displays InterlinearData JSON by default when parser returns data', async () => {
    await renderWebView();

    expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
    expect(screen.getByText(/glossLanguage/i)).toBeInTheDocument();
    expect(screen.getByText(/bookId/i)).toBeInTheDocument();
  });

  it('displays parsed structure including glossLanguage and bookId values', async () => {
    await renderWebView();

    expect(screen.getByText(/"en"/)).toBeInTheDocument();
    expect(screen.getByText(/"JHN"/)).toBeInTheDocument();
  });

  it('does not show parse error when parser succeeds', async () => {
    await renderWebView();

    expect(screen.queryByText(/^parse error$/i)).not.toBeInTheDocument();
  });

  it('displays parse error when parser throws an Error (uses err.message)', async () => {
    mockParse.mockImplementationOnce(() => {
      throw new Error('Invalid XML structure');
    });

    await renderWebView();

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid xml structure/i)).toBeInTheDocument();
  });

  it('switching to Interlinear shows rendered view with book ref', async () => {
    await renderWebView();

    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    expect(screen.getByText(/^Interlinear \(rendered\):$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'JHN', level: 2 })).toBeInTheDocument();
  });

  it('Interlinear view shows segment ref, word surface text, gloss, and punctuation', async () => {
    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:1')).toBeInTheDocument();
    });
    expect(screen.getAllByText('In').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(',').length).toBeGreaterThanOrEqual(1);
  });

  it('Interlinear view shows "Converting Paratext 9 data…" while conversion is in flight', async () => {
    let resolveConvert: ((value: typeof stubAlignment) => void) | undefined;
    const convertPromise = new Promise<typeof stubAlignment>((resolve) => {
      resolveConvert = resolve;
    });
    mockConvertAlignment.mockReturnValueOnce(convertPromise);

    await act(async () => {
      render(<InterlinearizerWebView {...testWebViewProps} />);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    expect(screen.getByText(/Converting Paratext 9 data…/)).toBeInTheDocument();

    await act(async () => {
      if (resolveConvert) resolveConvert(stubAlignment);
      await convertPromise;
    });
  });

  it('Interlinear view shows "No alignment or analyses available." when conversion rejects', async () => {
    mockConvertAlignment.mockRejectedValueOnce(new Error('Conversion failed'));

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText(/No alignment or analyses available\./)).toBeInTheDocument();
    });
  });

  it('Interlinear view shows "No alignment or analyses available." when sourceAnalysesMap is undefined', async () => {
    mockCreateSourceAnalyses.mockReturnValueOnce(undefined);

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText(/No alignment or analyses available\./)).toBeInTheDocument();
    });
  });

  it('Interlinear view shows surface form on Gloss row when word has assignment but analysis missing from map', async () => {
    const interlinearWithMissingAnalysis = {
      ...stubInterlinearization,
      books: [
        {
          id: 'mock-book-id',
          bookRef: 'JHN',
          textVersion: '',
          segments: [
            {
              id: 'seg-no-gloss',
              segmentRef: 'JHN 1:2',
              occurrences: [
                {
                  id: 'occ-no-analysis',
                  segmentId: 'seg-no-gloss',
                  index: 0,
                  anchor: '0-3',
                  surfaceText: 'the',
                  writingSystem: '',
                  type: 'word',
                  assignments: [
                    {
                      id: 'assign-unknown',
                      occurrenceId: 'occ-no-analysis',
                      analysisId: 'nonexistent-analysis-id',
                      status: 'approved',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const targetWithSameLayout = {
      ...stubTargetInterlinearization,
      books: [
        {
          ...stubTargetBook,
          segments: [
            {
              id: 'seg-no-gloss-target',
              segmentRef: 'JHN 1:2',
              baselineText: '',
              occurrences: [
                {
                  id: 'occ-no-analysis-target',
                  segmentId: 'seg-no-gloss-target',
                  index: 0,
                  anchor: '0-3',
                  surfaceText: 'the',
                  writingSystem: '',
                  type: 'word',
                  assignments: [],
                },
              ],
            },
          ],
        },
      ],
    };
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: interlinearWithMissingAnalysis,
      target: targetWithSameLayout,
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:2')).toBeInTheDocument();
    });
    // Gloss row shows target occurrence.surfaceText, so "the" appears in both Source and Gloss rows
    expect(screen.getAllByText('the').length).toBeGreaterThanOrEqual(1);
  });

  it('Interlinear view shows Analyses line with multiple glosses when word has multiple assignments', async () => {
    const analysisId1 = 'target-analysis-multi-1';
    const analysisId2 = 'target-analysis-multi-2';
    const interlinearWithMultipleAnalyses = {
      ...stubInterlinearization,
      books: [
        {
          id: 'mock-book-id',
          bookRef: 'JHN',
          textVersion: '',
          segments: [
            {
              id: 'seg-multi',
              segmentRef: 'JHN 1:5',
              occurrences: [
                {
                  id: 'occ-multi',
                  segmentId: 'seg-multi',
                  index: 0,
                  anchor: '0-4',
                  surfaceText: 'word',
                  writingSystem: '',
                  type: 'word',
                  assignments: [
                    {
                      id: 'a1',
                      occurrenceId: 'occ-multi',
                      analysisId: 'analysis-multi-1',
                      status: 'approved',
                    },
                    {
                      id: 'a2',
                      occurrenceId: 'occ-multi',
                      analysisId: 'analysis-multi-2',
                      status: 'approved',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const targetSegmentMulti = {
      id: 'seg-multi-target',
      segmentRef: 'JHN 1:5',
      baselineText: '',
      occurrences: [
        {
          id: 'occ-multi-target',
          segmentId: 'seg-multi-target',
          index: 0,
          anchor: '0-4',
          surfaceText: '',
          writingSystem: '',
          type: 'word',
          assignments: [
            {
              id: 'a1-t',
              occurrenceId: 'occ-multi-target',
              analysisId: analysisId1,
              status: 'approved',
            },
            {
              id: 'a2-t',
              occurrenceId: 'occ-multi-target',
              analysisId: analysisId2,
              status: 'approved',
            },
          ],
        },
      ],
    };
    const targetAnalysesMapWithMultiple = new Map([
      ...stubTargetAnalysesMap,
      [
        analysisId1,
        {
          id: analysisId1,
          analysisLanguage: 'en',
          analysisType: AnalysisType.Morph,
          confidence: Confidence.Medium,
          sourceSystem: 'paratext-9',
          sourceUser: 'paratext-9-parser',
          glossText: 'stem',
          morphemeBundles: [
            { id: `${analysisId1}-bundle-0`, index: 0, form: 'stem', writingSystem: '' },
          ],
        },
      ],
      [
        analysisId2,
        {
          id: analysisId2,
          analysisLanguage: 'en',
          analysisType: AnalysisType.Morph,
          confidence: Confidence.Medium,
          sourceSystem: 'paratext-9',
          sourceUser: 'paratext-9-parser',
          glossText: 'suffix',
          morphemeBundles: [
            { id: `${analysisId2}-bundle-0`, index: 0, form: '-suffix', writingSystem: '' },
          ],
        },
      ],
    ]);
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: interlinearWithMultipleAnalyses,
      target: {
        ...stubTargetInterlinearization,
        books: [{ ...stubTargetBook, segments: [targetSegmentMulti] }],
      },
    });
    mockCreateTargetAnalyses.mockReturnValueOnce(targetAnalysesMapWithMultiple);

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:5')).toBeInTheDocument();
    });
    expect(screen.getAllByText('word').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('stem suffix')).toBeInTheDocument();
  });

  it('Interlinear view shows only morph glosses when occurrence has mixed morph and non-morph assignments', async () => {
    const morphId = 'target-analysis-morph-only';
    const morphNullGlossId = 'target-analysis-morph-null-gloss';
    const wordformId = 'target-analysis-wordform';
    const sourceWithMixed = {
      ...stubInterlinearization,
      books: [
        {
          id: 'mock-book-id',
          bookRef: 'JHN',
          textVersion: '',
          segments: [
            {
              id: 'seg-mixed',
              segmentRef: 'JHN 1:6',
              occurrences: [
                {
                  id: 'occ-mixed',
                  segmentId: 'seg-mixed',
                  index: 0,
                  anchor: '0-4',
                  surfaceText: 'word',
                  writingSystem: '',
                  type: 'word',
                  assignments: [
                    {
                      id: 'a-morph',
                      occurrenceId: 'occ-mixed',
                      analysisId: morphId,
                      status: 'approved',
                    },
                    {
                      id: 'a-morph-null',
                      occurrenceId: 'occ-mixed',
                      analysisId: morphNullGlossId,
                      status: 'approved',
                    },
                    {
                      id: 'a-wf',
                      occurrenceId: 'occ-mixed',
                      analysisId: wordformId,
                      status: 'approved',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const targetSegmentMixed = {
      id: 'seg-mixed-target',
      segmentRef: 'JHN 1:6',
      baselineText: '',
      occurrences: [
        {
          id: 'occ-mixed-target',
          segmentId: 'seg-mixed-target',
          index: 0,
          anchor: '0-4',
          surfaceText: '',
          writingSystem: '',
          type: 'word',
          assignments: [
            {
              id: 'a-morph-t',
              occurrenceId: 'occ-mixed-target',
              analysisId: morphId,
              status: 'approved',
            },
            {
              id: 'a-morph-null-t',
              occurrenceId: 'occ-mixed-target',
              analysisId: morphNullGlossId,
              status: 'approved',
            },
            {
              id: 'a-wf-t',
              occurrenceId: 'occ-mixed-target',
              analysisId: wordformId,
              status: 'approved',
            },
          ],
        },
      ],
    };
    const targetAnalysesMapMixed = new Map([
      ...stubTargetAnalysesMap,
      [
        morphId,
        {
          id: morphId,
          analysisLanguage: 'en',
          analysisType: AnalysisType.Morph,
          confidence: Confidence.Medium,
          sourceSystem: 'paratext-9',
          sourceUser: 'paratext-9-parser',
          glossText: 'onlyMorph',
          morphemeBundles: [{ id: `${morphId}-bundle`, index: 0, form: 'only', writingSystem: '' }],
        },
      ],
      [
        morphNullGlossId,
        {
          id: morphNullGlossId,
          analysisLanguage: 'en',
          analysisType: AnalysisType.Morph,
          confidence: Confidence.Medium,
          sourceSystem: 'paratext-9',
          sourceUser: 'paratext-9-parser',
          glossText: undefined,
          morphemeBundles: [
            { id: `${morphNullGlossId}-bundle`, index: 0, form: 'x', writingSystem: '' },
          ],
        },
      ],
      [
        wordformId,
        {
          id: wordformId,
          analysisLanguage: 'en',
          analysisType: AnalysisType.Wordform,
          confidence: Confidence.Medium,
          sourceSystem: 'paratext-9',
          sourceUser: 'paratext-9-parser',
          glossText: undefined,
          morphemeBundles: [],
        },
      ],
    ]);
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: sourceWithMixed,
      target: {
        ...stubTargetInterlinearization,
        books: [{ ...stubTargetBook, segments: [targetSegmentMixed] }],
      },
    });
    mockCreateTargetAnalyses.mockReturnValueOnce(targetAnalysesMapMixed);

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:6')).toBeInTheDocument();
    });
    expect(screen.getByText('onlyMorph')).toBeInTheDocument();
  });

  it('Interlinear view skips rendering book when target has fewer books than source', async () => {
    const secondSourceBook = {
      id: 'mock-book-2',
      bookRef: 'MAT',
      textVersion: '',
      segments: [
        {
          id: 'seg-mat-1',
          segmentRef: 'MAT 1:1',
          occurrences: [
            {
              id: 'occ-mat',
              segmentId: 'seg-mat-1',
              index: 0,
              anchor: '0-3',
              surfaceText: 'One',
              writingSystem: '',
              type: 'word',
              assignments: [],
            },
          ],
        },
      ],
    };
    const sourceBooks = stubInterlinearization.books;
    const sourceTwoBooks = {
      ...stubInterlinearization,
      books: [...sourceBooks, secondSourceBook],
    };
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: sourceTwoBooks,
      target: stubTargetInterlinearization,
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN')).toBeInTheDocument();
    });
    expect(screen.getByText('JHN 1:1')).toBeInTheDocument();
    expect(screen.queryByText('MAT')).not.toBeInTheDocument();
  });

  it('Interlinear view skips rendering segment when target book has fewer segments than source', async () => {
    const secondSourceSegment = {
      id: 'seg-source-2',
      segmentRef: 'JHN 1:2',
      occurrences: [
        {
          id: 'occ-s2',
          segmentId: 'seg-source-2',
          index: 0,
          anchor: '0-3',
          surfaceText: 'the',
          writingSystem: '',
          type: 'word',
          assignments: [],
        },
      ],
    };
    const firstBook = stubInterlinearization.books[0];
    const sourceTwoSegments = {
      ...stubInterlinearization,
      books: [
        {
          ...firstBook,
          segments: [...firstBook.segments, secondSourceSegment],
        },
      ],
    };
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: sourceTwoSegments,
      target: stubTargetInterlinearization,
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:1')).toBeInTheDocument();
    });
    expect(screen.queryByText('JHN 1:2')).not.toBeInTheDocument();
  });

  it('Interlinear view shows "—" on Gloss row for word with empty assignments', async () => {
    const interlinearWithNoAssignments = {
      ...stubInterlinearization,
      books: [
        {
          id: 'mock-book-id',
          bookRef: 'JHN',
          textVersion: '',
          segments: [
            {
              id: 'seg-empty-assign',
              segmentRef: 'JHN 1:3',
              occurrences: [
                {
                  id: 'occ-empty',
                  segmentId: 'seg-empty-assign',
                  index: 0,
                  anchor: '0-4',
                  surfaceText: 'word',
                  writingSystem: '',
                  type: 'word',
                  assignments: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const targetNoAssignments = {
      ...stubTargetInterlinearization,
      books: [
        {
          ...stubTargetBook,
          segments: [
            {
              id: 'seg-empty-assign-target',
              segmentRef: 'JHN 1:3',
              baselineText: '',
              occurrences: [
                {
                  id: 'occ-empty-target',
                  segmentId: 'seg-empty-assign-target',
                  index: 0,
                  anchor: '0-4',
                  surfaceText: '',
                  writingSystem: '',
                  type: 'word',
                  assignments: [],
                },
              ],
            },
          ],
        },
      ],
    };
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: interlinearWithNoAssignments,
      target: targetNoAssignments,
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:3')).toBeInTheDocument();
    });
    expect(screen.getAllByText('word').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('Interlinear view shows placeholders when surfaceText is empty (· for word, — for punctuation)', async () => {
    const interlinearWithEmptySurface = {
      ...stubInterlinearization,
      books: [
        {
          id: 'mock-book-id',
          bookRef: 'JHN',
          textVersion: '',
          segments: [
            {
              id: 'seg-placeholders',
              segmentRef: 'JHN 1:4',
              occurrences: [
                {
                  id: 'occ-word',
                  segmentId: 'seg-placeholders',
                  index: 0,
                  anchor: '0-0',
                  surfaceText: '',
                  writingSystem: '',
                  type: 'word',
                  assignments: [],
                },
                {
                  id: 'occ-punct',
                  segmentId: 'seg-placeholders',
                  index: 1,
                  anchor: '0-0',
                  surfaceText: '',
                  writingSystem: '',
                  type: 'punctuation',
                  assignments: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const targetEmptySurface = {
      ...stubTargetInterlinearization,
      books: [
        {
          ...stubTargetBook,
          segments: [
            {
              id: 'seg-placeholders-target',
              segmentRef: 'JHN 1:4',
              baselineText: '',
              occurrences: [
                {
                  id: 'occ-word-t',
                  segmentId: 'seg-placeholders-target',
                  index: 0,
                  anchor: '0-0',
                  surfaceText: '',
                  writingSystem: '',
                  type: 'word',
                  assignments: [],
                },
                {
                  id: 'occ-punct-t',
                  segmentId: 'seg-placeholders-target',
                  index: 1,
                  anchor: '0-0',
                  surfaceText: '',
                  writingSystem: '',
                  type: 'punctuation',
                  assignments: [],
                },
              ],
            },
          ],
        },
      ],
    };
    mockConvertAlignment.mockResolvedValueOnce({
      ...stubAlignment,
      source: interlinearWithEmptySurface,
      target: targetEmptySurface,
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));

    await waitFor(() => {
      expect(screen.getByText('JHN 1:4')).toBeInTheDocument();
    });
    expect(screen.getByText('·')).toBeInTheDocument();
    const emDashes = screen.getAllByText('—');
    expect(emDashes.length).toBeGreaterThanOrEqual(1);
  });

  it('switching to Interlinearization shows converted model JSON', async () => {
    await renderWebView();

    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));

    expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/analysisLanguages/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/sourceWritingSystem/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/segments/i)).toBeInTheDocument());
  });

  it('switching back to InterlinearData shows PT9 structure JSON', async () => {
    await renderWebView();

    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));
    await waitFor(() => {
      expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('radio', { name: /^interlineardata$/i }));

    expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
    expect(screen.getByText(/glossLanguage/i)).toBeInTheDocument();
    expect(screen.getByText(/bookId/i)).toBeInTheDocument();
  });

  it('switching to Analyses shows analysis map JSON from test data', async () => {
    await renderWebView();

    fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));

    expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();
    expect(mockCreateSourceAnalyses).toHaveBeenCalledWith(stubInterlinearData);
    expect(mockCreateTargetAnalyses).toHaveBeenCalledWith(stubInterlinearData, expect.any(Object));
    expect(screen.getByText(/analysis-en-lex1-s1/)).toBeInTheDocument();
    expect(screen.getByText(/glossText/i)).toBeInTheDocument();
    expect(screen.getByText(/paratext-9/i)).toBeInTheDocument();
  });

  it('Analyses view shows empty JSON pre when createSourceAnalyses returns undefined', async () => {
    mockCreateSourceAnalyses.mockReturnValueOnce(undefined);

    const { container } = await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));
    await waitFor(() => {
      expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();
    });

    const jsonPre = container.querySelector('pre');
    expect(jsonPre).toBeInTheDocument();
    expect(jsonPre).toBeEmptyDOMElement();
    expect(jsonPre).not.toHaveTextContent('undefined');
  });

  it('uses no glossary when Lexicon parse throws (glossLookup undefined)', async () => {
    jest.mocked(lexiconParser.parseLexicon).mockImplementationOnce(() => {
      throw new Error('Invalid Lexicon XML');
    });

    await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));

    await waitFor(() => {
      expect(mockCreateTargetAnalyses).toHaveBeenCalledWith(stubInterlinearData, {
        glossLookup: undefined,
      });
    });
  });

  it('renders empty JSON pre when jsonToShow is undefined (converter returns undefined)', async () => {
    mockConvertAlignment.mockResolvedValueOnce(undefined);

    const { container } = await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));
    await waitFor(() => {
      expect(container.querySelector('pre')).toBeInTheDocument();
    });

    const jsonPre = container.querySelector('pre');
    expect(jsonPre).toBeInTheDocument();
    expect(jsonPre).toBeEmptyDOMElement();
    expect(jsonPre).not.toHaveTextContent('undefined');
  });

  it('shows "Converting..." in Interlinearization view while conversion is in flight', async () => {
    let resolveConvert: ((value: typeof stubAlignment) => void) | undefined;
    const convertPromise = new Promise<typeof stubAlignment>((resolve) => {
      resolveConvert = resolve;
    });
    mockConvertAlignment.mockReturnValueOnce(convertPromise);

    const { container } = await act(async () => {
      const result = render(<InterlinearizerWebView {...testWebViewProps} />);
      await Promise.resolve();
      return result;
    });

    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));

    await waitFor(() => {
      const jsonPre = container.querySelector('pre');
      expect(jsonPre).toHaveTextContent('Converting...');
    });

    await act(async () => {
      if (resolveConvert) resolveConvert(stubAlignment);
      await convertPromise;
    });

    await waitFor(() => {
      expect(screen.getByText(/analysisLanguages/i)).toBeInTheDocument();
    });
  });

  it('displays parse error when parser throws non-Error (uses String(err))', async () => {
    mockParse.mockImplementationOnce(() => {
      // Intentionally throw a non-Error to test the String(err) branch in the catch block.
      // eslint-disable-next-line no-throw-literal -- testing non-Error handling
      throw 'plain string error';
    });

    await renderWebView();

    expect(screen.getByRole('heading', { name: /^parse error$/i })).toBeInTheDocument();
    expect(screen.getByText('plain string error')).toBeInTheDocument();
  });

  it('sets alignment to undefined when converter rejects', async () => {
    mockConvertAlignment.mockRejectedValueOnce(new Error('Conversion failed'));

    const { container } = await renderWebView();
    fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));
    await waitFor(() => {
      expect(container.querySelector('pre')).toBeInTheDocument();
    });

    const jsonPre = container.querySelector('pre');
    expect(jsonPre).toBeInTheDocument();
    expect(jsonPre).toBeEmptyDOMElement();
  });

  describe('handleJsonViewModeKeyDown', () => {
    it('ArrowRight moves to next mode and updates selection', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
      });

      expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^interlinearization$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('ArrowDown moves to next mode', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowDown' });
      });
      expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowDown' });
      });
      expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();
    });

    it('ArrowRight from last mode (Analyses) wraps to first (Interlinear)', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));
      expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
      });

      expect(screen.getByText(/^Interlinear \(rendered\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^interlinear$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('ArrowLeft moves to previous mode', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      fireEvent.click(screen.getByRole('radio', { name: /^analyses$/i }));
      expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowLeft' });
      });

      expect(screen.getByText(/^Interlinearization \(JSON\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^interlinearization$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('ArrowUp moves to previous mode', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      fireEvent.click(screen.getByRole('radio', { name: /^interlinearization$/i }));

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowUp' });
      });

      expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^interlineardata$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('ArrowLeft from first mode (Interlinear) wraps to last (Analyses)', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      fireEvent.click(screen.getByRole('radio', { name: /^interlinear$/i }));
      expect(screen.getByText(/^Interlinear \(rendered\):$/)).toBeInTheDocument();

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowLeft' });
      });

      expect(screen.getByText(/^Analyses \(JSON\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^analyses$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('non-arrow key does not change mode', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();

      fireEvent.keyDown(radiogroup, { key: 'a' });
      fireEvent.keyDown(radiogroup, { key: 'Enter' });
      expect(screen.getByText(/^InterlinearData \(JSON\):$/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^interlineardata$/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('moves focus to the newly selected radio on arrow key', async () => {
      await renderWebView();
      const radiogroup = screen.getByRole('radiogroup', { name: /view json as:/i });
      const interlinearizationRadio = screen.getByRole('radio', {
        name: /^interlinearization$/i,
      });

      await act(async () => {
        fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
      });

      expect(document.activeElement).toBe(interlinearizationRadio);
    });

    it('does nothing when current view mode is not in JSON_VIEW_MODES (idx === -1)', () => {
      const setJsonViewMode = jest.fn();
      const focusRadio = jest.fn();
      // Pass a value not in JSON_VIEW_MODES so findIndex returns -1; handler takes string for testability.
      handleJsonViewModeKeyDown('invalid', 'ArrowRight', setJsonViewMode, focusRadio);

      expect(setJsonViewMode).not.toHaveBeenCalled();
      expect(focusRadio).not.toHaveBeenCalled();
    });
  });
});
