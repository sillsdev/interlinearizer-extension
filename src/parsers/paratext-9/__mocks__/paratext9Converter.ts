/**
 * @file Jest manual mock for parsers/paratext-9/paratext9Converter. Placed adjacent to the module so
 * jest.mock('parsers/paratext-9/paratext9Converter') picks it up automatically. Used by
 * interlinearizer.web-view tests so the WebView does not run real conversion.
 */

/** Stub Interlinearization returned by mockConvert. Matches shape the WebView displays. */
export const stubInterlinearization = {
  id: 'mock-interlinear-id',
  sourceWritingSystem: '',
  analysisLanguages: ['en'],
  books: [{ id: 'mock-book-id', bookRef: 'MAT', textVersion: '', segments: [] }],
};

/** Stub analyses map for Analyses view (ID → Analysis). */
export const stubAnalysesMap = new Map([
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

export const mockConvert = jest.fn().mockResolvedValue(stubInterlinearization);
export const mockCreateAnalyses = jest.fn().mockReturnValue(stubAnalysesMap);

export const convertParatext9ToInterlinearization = mockConvert;
export const createAnalyses = mockCreateAnalyses;
